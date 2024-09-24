const expect = require('chai').expect;
const { getBridge } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelpers, getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { satoshisToBtc, btcToSatoshis, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { waitAndUpdateBridge, mineAndSync, findEventInBlock } = require('../rsk-utils');
const { PEGIN_EVENTS } = require("../constants");
const { sendPegin,
    ensurePeginIsRegistered,
    donateToBridge,
    createSenderRecipientInfo,
    createExpectedPeginBtcEvent
} = require('../2wp-utils');
const { ensure0x } = require('../utils');
const { getBtcAddressBalanceInSatoshis } = require('../btc-utils');

const DONATION_AMOUNT = 250;

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let bridge;
let federationAddress;
let minimumPeginValueInSatoshis;
let minimumPeginValueInBtc;
let btcFeeInSatoshis;

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
      minimumPeginValueInSatoshis = Number(await bridge.methods.getMinimumLockTxValue().call());
      minimumPeginValueInBtc = Number(satoshisToBtc(minimumPeginValueInSatoshis));
      btcFeeInSatoshis = btcToSatoshis(await btcTxHelper.getFee());

      await btcTxHelper.importAddress(federationAddress, 'federation');
      await waitAndUpdateBridge(rskTxHelper);
      await setupBridgeDonation(rskTxHelpers, btcTxHelper);

    });

    it('should do a basic legacy pegin', async () => {

      // Arrange

      const initialFederationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;

      // Act

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis));
      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

      // Assert

      // The btc pegin tx is already marked as processed by the bridge
      const isBtcTxHashAlreadyProcessed = await bridge.methods.isBtcTxHashAlreadyProcessed(btcPeginTxHash).call();
      expect(isBtcTxHashAlreadyProcessed).to.be.true;

      // The pegin_btc event is emitted with the expected values
      const recipient1RskAddressChecksumed = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(senderRecipientInfo.rskRecipientRskAddressInfo.address));
      const expectedEvent = createExpectedPeginBtcEvent(PEGIN_EVENTS.PEGIN_BTC, recipient1RskAddressChecksumed, btcPeginTxHash, btcToSatoshis(minimumPeginValueInBtc));
      const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
      const peginBtcEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, btcTxHashProcessedHeight);
      expect(peginBtcEvent).to.be.deep.equal(expectedEvent);

      // The federation balance is increased by the pegin value
      const finalFederationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
      expect(finalFederationAddressBalanceInSatoshis).to.be.equal(initialFederationAddressBalanceInSatoshis + peginValueInSatoshis);

      // The sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);

      // The recipient rsk address balance is increased by the pegin value
      const finalRskRecipientBalance = Number(await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address));
      expect(finalRskRecipientBalance).to.be.equal(Number(satoshisToWeis(peginValueInSatoshis)));

    });

  });

}

module.exports = {
  execute,
};
