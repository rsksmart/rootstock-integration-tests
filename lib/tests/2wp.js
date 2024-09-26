const expect = require('chai').expect;
const { getBridge } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelpers, getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { satoshisToBtc, btcToSatoshis, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { findEventInBlock } = require('../rsk-utils');
const { PEGIN_EVENTS } = require("../constants");
const { sendPegin,
    ensurePeginIsRegistered,
    createSenderRecipientInfo,
    createExpectedPeginBtcEvent,
    BRIDGE_ADDRESS,
    getBridgeUtxosBalance,
} = require('../2wp-utils');
const { ensure0x } = require('../utils');
const { getBtcAddressBalanceInSatoshis } = require('../btc-utils');

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let bridge;
let federationAddress;
let minimumPeginValueInSatoshis;
let minimumPeginValueInBtc;
let btcFeeInSatoshis;

const get2wpInitialBalances = async () => {
  const initialBridgeBalanceInWeisBN = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));
  const initialBridgeUtxosBalanceInSatoshis = await getBridgeUtxosBalance(rskTxHelper);
  const initialFederationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
  return {
    initialBridgeBalanceInWeisBN,
    initialBridgeUtxosBalanceInSatoshis,
    initialFederationAddressBalanceInSatoshis,
  };
};

const assertExpectedPeginBtcEventIsEmitted = async (btcPeginTxHash, rskRecipientAddress, peginValueInSatoshis) => {
  const recipient1RskAddressChecksumed = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(rskRecipientAddress));
  const expectedEvent = createExpectedPeginBtcEvent(PEGIN_EVENTS.PEGIN_BTC, recipient1RskAddressChecksumed, btcPeginTxHash, peginValueInSatoshis);
  const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
  const peginBtcEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, btcTxHashProcessedHeight);
  expect(peginBtcEvent).to.be.deep.equal(expectedEvent);
};

const assertSuccessfulPegin2wpFinalBalances = async (initial2wpBalances, peginValueInSatoshis) => {

  const { initialBridgeBalanceInWeisBN, initialBridgeUtxosBalanceInSatoshis, initialFederationAddressBalanceInSatoshis } = initial2wpBalances

  // The federation balance is increased by the pegin value
  const finalFederationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
  expect(finalFederationAddressBalanceInSatoshis).to.be.equal(initialFederationAddressBalanceInSatoshis + peginValueInSatoshis);

  // After the successful pegin, the Bridge balance should be reduced by the pegin value
  const finalBridgeBalance = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));
  expect(finalBridgeBalance).to.be.equal(initialBridgeBalanceInWeisBN - satoshisToWeis(peginValueInSatoshis));

  // After the successful pegin, the Bridge utxos sum should be incremented by the pegin value
  const finalBridgeUtxosBalance = await getBridgeUtxosBalance(rskTxHelper);
  expect(finalBridgeUtxosBalance).to.be.equal(initialBridgeUtxosBalanceInSatoshis + peginValueInSatoshis);

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

    });

    it('should do a basic legacy pegin with the exact minimum value', async () => {

      // Arrange

      const initial2wpBalances = await get2wpInitialBalances();
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;

      // Act

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis));
      
      // Assert

      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, senderRecipientInfo.rskRecipientRskAddressInfo.address, peginValueInSatoshis);

      await assertSuccessfulPegin2wpFinalBalances(initial2wpBalances, peginValueInSatoshis);

      // The btc sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);

      // The recipient rsk address balance is increased by the pegin value
      const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
      const expectedRskRecipientBalancesInWeisBN = rskTxHelper.getClient().utils.BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)).to.be.true;

    });

  });

}

module.exports = {
  execute,
};
