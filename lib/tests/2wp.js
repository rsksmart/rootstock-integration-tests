const expect = require('chai').expect;
const { getBridge } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelpers, getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { satoshisToBtc, btcToWeis, btcToSatoshis } = require('@rsksmart/btc-eth-unit-converter');
const { waitAndUpdateBridge, mineAndSync } = require('../rsk-utils');
const { PEGIN_EVENTS } = require("../constants");
const { findAndCheckPeginBtcEventInBlock } = require('../assertions/2wp');
const { sendPegin,
    ensurePeginIsRegistered,
    donateToBridge,
    createSenderRecipientInfo,
    createExpectedPeginBtcEvent
} = require('../2wp-utils');

const DONATION_AMOUNT = 250;

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let bridge;
let federationAddress;
let minimumPeginValueInBtc;

const setupBridgeDonation = async (rskTxHelpers, btcTxHelper) => {
  const donatingBtcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
  await mineAndSync(rskTxHelpers);
  await btcTxHelper.fundAddress(donatingBtcAddressInformation.address, DONATION_AMOUNT + btcTxHelper.getFee());
  await donateToBridge(rskTxHelpers[0], btcTxHelper, donatingBtcAddressInformation, DONATION_AMOUNT);
};

const execute = (description, getRskHost) => {

  describe(description, () => {

    before(async () => {

      rskTxHelpers = getRskTransactionHelpers();
      btcTxHelper = getBtcClient();
      rskTxHelper = getRskTransactionHelper(getRskHost());
      bridge = getBridge(rskTxHelper.getClient());

      federationAddress = await bridge.methods.getFederationAddress().call();
      const minimumPeginValueInSatoshis = await bridge.methods.getMinimumLockTxValue().call();
      minimumPeginValueInBtc = Number(satoshisToBtc(minimumPeginValueInSatoshis));

      await btcTxHelper.importAddress(federationAddress, 'federation');
      await waitAndUpdateBridge(rskTxHelper);
      await setupBridgeDonation(rskTxHelpers, btcTxHelper);

    });

    it('should transfer BTC to RBTC', async () => {

      // Arrange

      const senderInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialFederationAddressBalanceInBtc = Number(await btcTxHelper.getAddressBalance(federationAddress));
      const initialSenderAddressBalanceInBtc = Number(await btcTxHelper.getAddressBalance(senderInfo.btcSenderAddressInfo.address));
      const initialRskRecipientBalance = Number(await rskTxHelper.getBalance(senderInfo.rskRecipientRskAddressInfo.address));

      // Act

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderInfo.btcSenderAddressInfo, minimumPeginValueInBtc);
      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

      // Assert

      const isBtcTxHashAlreadyProcessed = await bridge.methods.isBtcTxHashAlreadyProcessed(btcPeginTxHash).call();
      expect(isBtcTxHashAlreadyProcessed).to.be.true;

      const expectedEvent = createExpectedPeginBtcEvent(PEGIN_EVENTS.PEGIN_BTC, senderInfo.rskRecipientRskAddressInfo.address, btcPeginTxHash, btcToSatoshis(minimumPeginValueInBtc), '0');
      const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
      await findAndCheckPeginBtcEventInBlock(rskTxHelper, btcTxHashProcessedHeight, expectedEvent);

      const finalFederationAddressBalanceInBtc = Number(await btcTxHelper.getAddressBalance(federationAddress));
      expect(finalFederationAddressBalanceInBtc).to.be.equal(initialFederationAddressBalanceInBtc + minimumPeginValueInBtc);

      const finalSenderAddressBalanceInBtc = Number(await btcTxHelper.getAddressBalance(senderInfo.btcSenderAddressInfo.address));
      expect(finalSenderAddressBalanceInBtc).to.be.equal(initialSenderAddressBalanceInBtc - minimumPeginValueInBtc - btcTxHelper.getFee());

      const finalRskRecipientBalance = Number(await rskTxHelper.getBalance(senderInfo.rskRecipientRskAddressInfo.address));
      expect(finalRskRecipientBalance).to.be.equal(initialRskRecipientBalance + Number(btcToWeis(minimumPeginValueInBtc)));

    });

  });

}

module.exports = {
  execute,
};
