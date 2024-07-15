const expect = require('chai').expect
const { ensure0x, removePrefix0x} = require('../utils');
const whitelistingAssertions = require('../assertions/whitelisting');
const rskUtils = require('../rsk-utils');
const CustomError = require('../CustomError');
const { getBridge, getLatestActiveForkName } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelpers, getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { sendTxToBridge, sendPegin, ensurePeginIsRegistered, donateToBridge } = require('../2wp-utils');
const { waitAndUpdateBridge } = require('../rsk-utils');
const { decodeOutpointValues, encodeOutpointValuesAsMap } = require("../varint");
const {getBridgeState} = require("@rsksmart/bridge-state-data-parser");
const {PEGOUT_EVENTS} = require("../constants");

const DONATION_AMOUNT = 250;
const REJECTED_REASON = 1;

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let federationAddress;
let minimumPeginValueInBtc;

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
  const forkName = process.env.FORK_NAME || rskUtils.getLatestForkName().name;
  await rskUtils.activateFork(Runners.common.forks[forkName]);
};

const assertPegoutTransactionCreatedEventIsEmitted = async (localRskTxHelper, activeFederationUtxosBeforePegout) => {
  const pegoutTransactionCreatedEvent = await rskUtils.findEventInBlock(localRskTxHelper, PEGOUT_EVENTS.PEGOUT_TRANSACTION_CREATED);
  expect(pegoutTransactionCreatedEvent).to.not.be.null;
  const encodedUtxoOutpointValues = Buffer.from(removePrefix0x(pegoutTransactionCreatedEvent.arguments.utxoOutpointValues), 'hex');

  const federationUtxoValues = encodeOutpointValuesAsMap(activeFederationUtxosBeforePegout);

  const outpointValues = decodeOutpointValues(encodedUtxoOutpointValues);

  expect(outpointValues.every(value => value in federationUtxoValues)).to.be.true;
}

const execute = (description, getRskHost) => {

  describe(description, () => {
    before(async () => {
      btcTxHelper = getBtcClient();
      rskTxHelper = getRskTransactionHelper(getRskHost());

      if(process.env.RUNNING_SINGLE_TEST_FILE) {
        await fulfillRequirementsToRunAsSingleTestFile();
      }

      // Grab the federation address
      const bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
      federationAddress = await bridge.methods.getFederationAddress().call();

      const minimumPeginValueInSatoshis = await bridge.methods.getMinimumLockTxValue().call();
      minimumPeginValueInBtc = Number(btcEthUnitConverter.satoshisToBtc(minimumPeginValueInSatoshis));

      await btcTxHelper.importAddress(federationAddress, 'federations');

      rskTxHelpers = getRskTransactionHelpers();

      // Update the bridge to sync btc blockchains
      await waitAndUpdateBridge(rskTxHelper);

      // At the moment there are a lot of pegout tests that depend on the bridge to have enough balance.
      // Those tests are not doing a pegin if needed, so we need to donate to the bridge to ensure it has enough balance.
      // This will be removed after all pegout tests are updated to do their own pegin if needed.
      const donatingBtcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
      await whitelistingAssertions.assertAddLimitedLockWhitelistAddress(rskTxHelper, donatingBtcAddressInformation.address, Number(btcEthUnitConverter.btcToSatoshis(DONATION_AMOUNT)));
      await rskUtils.mineAndSync(rskTxHelpers);
      await btcTxHelper.fundAddress(donatingBtcAddressInformation.address, DONATION_AMOUNT + btcTxHelper.getFee());

      await donateToBridge(rskTxHelper, btcTxHelper, donatingBtcAddressInformation, DONATION_AMOUNT);

      return federationAddress;
    });

    it('should transfer BTC to RBTC', async () => {
      try {
        const peginSenderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');

        await whitelistingAssertions.assertAddLimitedLockWhitelistAddress(rskTxHelper, peginSenderAddressInfo.address, Number(btcEthUnitConverter.btcToSatoshis(minimumPeginValueInBtc)));
        await rskUtils.mineAndSync(rskTxHelpers);
        
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(peginSenderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
        const initialRskAddressBalanceInWeis = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));

        await btcTxHelper.fundAddress(peginSenderAddressInfo.address, minimumPeginValueInBtc + btcTxHelper.getFee());

        const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, peginSenderAddressInfo, minimumPeginValueInBtc);
        await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);
        
        const finalRskAddressBalanceInWeis = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));

        // Asserting that the received pegin amount in rsk is as expected
        const peginValueInWeis = Number(btcEthUnitConverter.btcToWeis(minimumPeginValueInBtc));
        expect(finalRskAddressBalanceInWeis).to.equal(initialRskAddressBalanceInWeis + peginValueInWeis);
      } catch (err) {
        throw new CustomError('Transfer BTC to RBTC', err);
      }
    });

    it('should transfer BTC to RBTC with 2 outputs in lock TX', async () => {
      try{
        const INITIAL_BTC_BALANCE = 4;
        const PEGIN_OUTPUTS_VALUES_IN_BTC = [1, 2];
        const EXPECTED_RSK_BALANCE_IN_RBTC = PEGIN_OUTPUTS_VALUES_IN_BTC.reduce((a, b) => a + b, 0); // 3

        const peginSenderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');

        await whitelistingAssertions.assertAddLimitedLockWhitelistAddress(rskTxHelper, peginSenderAddressInfo.address, Number(btcEthUnitConverter.btcToSatoshis(EXPECTED_RSK_BALANCE_IN_RBTC)));
        await rskUtils.mineAndSync(rskTxHelpers);
        await btcTxHelper.fundAddress(peginSenderAddressInfo.address, INITIAL_BTC_BALANCE + btcTxHelper.getFee());

        const recipientRskAddressInfo = getDerivedRSKAddressInformation(peginSenderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
  
        const initialRskAddressBalanceInWeis = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));

        const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, peginSenderAddressInfo, PEGIN_OUTPUTS_VALUES_IN_BTC);
        
        await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash, PEGIN_OUTPUTS_VALUES_IN_BTC.length);

        const finalRskAddressBalanceInWeis = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));

        // Asserting that the received pegin amount in rsk is as expected
        const peginValueInWeis = Number(btcEthUnitConverter.btcToWeis(EXPECTED_RSK_BALANCE_IN_RBTC));
        expect(finalRskAddressBalanceInWeis).to.equal(initialRskAddressBalanceInWeis + peginValueInWeis);

      }
      catch (err) {
        throw new CustomError('Transfer BTC to RBTC with 2 outputs in lock TX failure', err);
      }
    });

    it('should transfer RBTC to BTC - Above minimum pegout value', async () => {

        const INITIAL_RSK_BALANCE = 1;
        const PEGOUT_VALUE_IN_RBTC = 0.5;
        const MAX_EXPECTED_FEE = 0.001;
        const pegoutValueInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(PEGOUT_VALUE_IN_RBTC));
        const maxExpectedFeeInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(MAX_EXPECTED_FEE));

        const initialFederationBalanceInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(await btcTxHelper.getAddressBalance(federationAddress)));

        const btcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');

        const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInformation.privateKey, btcTxHelper.btcConfig.network);

        await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
        const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
        expect(unlocked, 'Account was not unlocked').to.be.true;

        await rskUtils.sendFromCow(rskTxHelper, recipientRskAddressInfo.address, Number(btcEthUnitConverter.btcToWeis(INITIAL_RSK_BALANCE)));

        const bridgeStateBeforePegout = await getBridgeState(rskTxHelper.getClient());
        const activeFederationUtxosBeforePegout = bridgeStateBeforePegout.activeFederationUtxos;
        const pegoutTransaction = await sendTxToBridge(rskTxHelper, PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);

        const isFingerroot500AlreadyActive = await Runners.common.forks.fingerroot500.isAlreadyActive();

        const isIris300AlreadyActive = await Runners.common.forks.iris300.isAlreadyActive();
        if (isIris300AlreadyActive) {
            const pegoutRequestReceivedEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_REQUEST_RECEIVED);
            expect(pegoutRequestReceivedEvent).to.not.be.null;
            const btcDestinationAddress = pegoutRequestReceivedEvent.arguments.btcDestinationAddress;
            expect(pegoutRequestReceivedEvent.arguments.sender.toLowerCase()).to.equal(ensure0x(recipientRskAddressInfo.address));
            expect(Number(pegoutRequestReceivedEvent.arguments.amount)).to.equal(pegoutValueInSatoshis);
            if(isFingerroot500AlreadyActive) {
              // After fingerroot, the btcDestinationAddress is in base58 format
              expect(btcAddressInformation.address).to.equal(btcDestinationAddress);
            } else {
              expect(btcAddressInformation.address).to.equal(ensure0x(btcTxHelper.decodeBase58Address(btcAddressInformation.address)));
            }
        }

        const pegoutCreatedValidations = async (localRskTxHelper) => {
          const isPapyrus200AlreadyActive = await Runners.common.forks.papyrus200.isAlreadyActive();
          if (isPapyrus200AlreadyActive) {
            const pegoutRequestedEvent = await rskUtils.findEventInBlock(localRskTxHelper, PEGOUT_EVENTS.RELEASE_REQUESTED);
            expect(pegoutRequestedEvent).to.not.be.null;
            expect(Number(pegoutRequestedEvent.arguments.amount)).to.equal(pegoutValueInSatoshis);
          }
          const isHop400AlreadyActive = await Runners.common.forks.hop400.isAlreadyActive();
          if (isHop400AlreadyActive) {
            const batchPegoutCreatedEvent = await rskUtils.findEventInBlock(localRskTxHelper, PEGOUT_EVENTS.BATCH_PEGOUT_CREATED);
            expect(batchPegoutCreatedEvent).to.not.be.null;
            expect(batchPegoutCreatedEvent.arguments.releaseRskTxHashes.includes(pegoutTransaction.transactionHash)).to.be.true;
          }

          const isLovell700AlreadyActive = await Runners.common.forks.lovell700.isAlreadyActive();
          if (isLovell700AlreadyActive) {
            await assertPegoutTransactionCreatedEventIsEmitted(localRskTxHelper, activeFederationUtxosBeforePegout);
          }
        };

        const pegoutConfirmedValidations = async (localRskTxHelper) => {
          if (isFingerroot500AlreadyActive) {
            const pegoutConfirmedEvent = await rskUtils.findEventInBlock(localRskTxHelper, PEGOUT_EVENTS.PEGOUT_CONFIRMED);
            expect(pegoutConfirmedEvent).to.not.be.null;
          }
        };

        const callbacks = {
          pegoutCreatedCallback: pegoutCreatedValidations,
          pegoutConfirmedCallback: pegoutConfirmedValidations,
        };

        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper, callbacks);
        const finalFederationBalanceInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(await btcTxHelper.getAddressBalance(federationAddress)));
        const finalDestinationAddressBalanceInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(await btcTxHelper.getAddressBalance(btcAddressInformation.address)));
        const difference = pegoutValueInSatoshis - finalDestinationAddressBalanceInSatoshis;
        expect(difference).to.be.at.most(maxExpectedFeeInSatoshis);
        expect(finalFederationBalanceInSatoshis).to.equal(initialFederationBalanceInSatoshis - pegoutValueInSatoshis);

    }); 

    it('should transfer RBTC to BTC - Below minimum pegout value', async() => {
      try {
        const INITIAL_RSK_BALANCE = 2;
        const PEGOUT_UNDER_MINIMUM_VALUE_IN_BTC = 0.002;
        
        const initialFederationBalanceInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(await btcTxHelper.getAddressBalance(federationAddress)));

        const btcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInformation.privateKey, btcTxHelper.btcConfig.network);

        await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
        await rskUtils.sendFromCow(rskTxHelper, recipientRskAddressInfo.address, Number(btcEthUnitConverter.btcToWeis(INITIAL_RSK_BALANCE)));
        const initialRskAddressBalance = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
        expect(unlocked, 'Account was not unlocked').to.be.true;

        const pegoutTransaction = await sendTxToBridge(rskTxHelper, PEGOUT_UNDER_MINIMUM_VALUE_IN_BTC, recipientRskAddressInfo.address);
        const isIris300AlreadyActive = await Runners.common.forks.iris300.isAlreadyActive();
        if (isIris300AlreadyActive) {
            const pegoutRejectedEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_REQUEST_REJECTED);
            expect(pegoutRejectedEvent).to.not.be.null;
            const pegoutValueInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(PEGOUT_UNDER_MINIMUM_VALUE_IN_BTC));
            expect(Number(pegoutRejectedEvent.arguments.amount)).to.equal(pegoutValueInSatoshis);
            expect(pegoutRejectedEvent.arguments.sender.toLowerCase()).to.equal(ensure0x(recipientRskAddressInfo.address));
            expect(Number(pegoutRejectedEvent.arguments.reason)).to.equal(REJECTED_REASON);
            const finalRskAddressBalance = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
            expect(finalRskAddressBalance + pegoutTransaction.gasUsed * 2).to.equal(initialRskAddressBalance);
        } else {
            const finalRskAddressBalance = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
            // The transaction should have been rejected and the RBTC should be lost
            expect(finalRskAddressBalance).to.be.at.most(initialRskAddressBalance - Number(btcEthUnitConverter.btcToWeis(PEGOUT_UNDER_MINIMUM_VALUE_IN_BTC)));
        }
        const finalFederationBalanceInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(await btcTxHelper.getAddressBalance(federationAddress)));
        expect(finalFederationBalanceInSatoshis).to.equal(initialFederationBalanceInSatoshis);
      }
      catch (err) {
        throw new CustomError('Transfer RBTC to BTC failure', err);
      }
    });

  });
}

module.exports = {
  execute,
};
