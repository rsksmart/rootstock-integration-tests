const expect = require('chai').expect
const { ensure0x} = require('../utils');
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
const {PEGOUT_EVENTS} = require("../constants");

const DONATION_AMOUNT = 250;
const REJECTED_REASON = 1;

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let federationAddress;
let minimumPeginValueInBtc;

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
