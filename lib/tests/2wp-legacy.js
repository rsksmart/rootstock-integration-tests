const expect = require('chai').expect
const { ensure0x, removePrefix0x} = require('../utils');
const whitelistingAssertions = require('../assertions/whitelisting');
const rskUtils = require('../rsk-utils');
const CustomError = require('../CustomError');
const { getBridge } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelpers, getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { sendTxToBridge, donateToBridge } = require('../2wp-utils');
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

const assertPegoutTransactionCreatedEventIsEmitted = async (localRskTxHelper, activeFederationUtxosBeforePegout) => {
  const pegoutTransactionCreatedEvent = await rskUtils.findEventInBlock(localRskTxHelper, PEGOUT_EVENTS.PEGOUT_TRANSACTION_CREATED.name);
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

      // Grab the federation address
      const bridge = getBridge(rskTxHelper.getClient());
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

        const pegoutRequestReceivedEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_REQUEST_RECEIVED.name);
        expect(pegoutRequestReceivedEvent).to.not.be.null;
        const btcDestinationAddress = pegoutRequestReceivedEvent.arguments.btcDestinationAddress;
        expect(pegoutRequestReceivedEvent.arguments.sender.toLowerCase()).to.equal(ensure0x(recipientRskAddressInfo.address));
        expect(Number(pegoutRequestReceivedEvent.arguments.amount)).to.equal(pegoutValueInSatoshis);
        expect(btcAddressInformation.address).to.equal(btcDestinationAddress);

        const pegoutCreatedValidations = async (localRskTxHelper) => {

          const pegoutRequestedEvent = await rskUtils.findEventInBlock(localRskTxHelper, PEGOUT_EVENTS.RELEASE_REQUESTED.name);
          expect(pegoutRequestedEvent).to.not.be.null;
          expect(Number(pegoutRequestedEvent.arguments.amount)).to.equal(pegoutValueInSatoshis);

          const batchPegoutCreatedEvent = await rskUtils.findEventInBlock(localRskTxHelper, PEGOUT_EVENTS.BATCH_PEGOUT_CREATED.name);
          expect(batchPegoutCreatedEvent).to.not.be.null;
          expect(batchPegoutCreatedEvent.arguments.releaseRskTxHashes.includes(pegoutTransaction.transactionHash)).to.be.true;

          // TODO: Uncomment this line when lovell700 is active.
          // await assertPegoutTransactionCreatedEventIsEmitted(localRskTxHelper, activeFederationUtxosBeforePegout);

        };

        const pegoutConfirmedValidations = async (localRskTxHelper) => {
          const pegoutConfirmedEvent = await rskUtils.findEventInBlock(localRskTxHelper, PEGOUT_EVENTS.PEGOUT_CONFIRMED.name);
          expect(pegoutConfirmedEvent).to.not.be.null;
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

        const pegoutRejectedEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_REQUEST_REJECTED.name);
        expect(pegoutRejectedEvent).to.not.be.null;
        const pegoutValueInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(PEGOUT_UNDER_MINIMUM_VALUE_IN_BTC));
        expect(Number(pegoutRejectedEvent.arguments.amount)).to.equal(pegoutValueInSatoshis);
        expect(pegoutRejectedEvent.arguments.sender.toLowerCase()).to.equal(ensure0x(recipientRskAddressInfo.address));
        expect(Number(pegoutRejectedEvent.arguments.reason)).to.equal(REJECTED_REASON);
        const finalRskAddressBalance = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(finalRskAddressBalance + pegoutTransaction.gasUsed * 2).to.equal(initialRskAddressBalance);

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
