const expect = require('chai').expect;
const BN = require('bn.js');
const { getBridge } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelper, getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const { satoshisToBtc, btcToSatoshis, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { findEventInBlock, triggerRelease } = require('../rsk-utils');
const { PEGIN_EVENTS, PEGIN_REJECTION_REASONS } = require("../constants");
const { sendPegin,
    ensurePeginIsRegistered,
    createSenderRecipientInfo,
    createExpectedPeginBtcEvent,
    get2wpBalances,
    mineForPeginRegistration,
    createExpectedRejectedPeginEvent,
} = require('../2wp-utils');
const { getBtcAddressBalanceInSatoshis, waitForBitcoinMempoolToGetTxs } = require('../btc-utils');
const { ensure0x } = require('../utils');
const bitcoinJsLib = require('bitcoinjs-lib');
const { createPeginV1TxData } = require('pegin-address-verificator');

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let bridge;
let federationAddress;
let minimumPeginValueInSatoshis;
let btcFeeInSatoshis;

const execute = (description, getRskHost) => {

  describe(description, () => {

    before(async () => {

      btcTxHelper = getBtcClient();
      rskTxHelper = getRskTransactionHelper(getRskHost());
      rskTxHelpers = getRskTransactionHelpers();
      bridge = getBridge(rskTxHelper.getClient());

      federationAddress = await bridge.methods.getFederationAddress().call();
      minimumPeginValueInSatoshis = Number(await bridge.methods.getMinimumLockTxValue().call());
      btcFeeInSatoshis = btcToSatoshis(await btcTxHelper.getFee());

      await btcTxHelper.importAddress(federationAddress, 'federation');

    });

    it('should do a basic legacy pegin with the exact minimum value', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;

      // Act

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis));
      
      // Assert

      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, senderRecipientInfo.rskRecipientRskAddressInfo.address, peginValueInSatoshis);

      await assert2wpBalancesAfterSuccessfulPegin(initial2wpBalances, peginValueInSatoshis);

      // The btc sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);

      // The recipient rsk address balance is increased by the pegin value
      const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
      const expectedRskRecipientBalancesInWeisBN = new BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)).to.be.true;

    });

    it('should do a basic legacy pegin with the value exactly above minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      // Value exactly above minimum
      const peginValueInSatoshis = minimumPeginValueInSatoshis + 1;

      // Act

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis));

      // Assert

      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, senderRecipientInfo.rskRecipientRskAddressInfo.address, peginValueInSatoshis);

      await assert2wpBalancesAfterSuccessfulPegin(initial2wpBalances, peginValueInSatoshis);

      // The sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);

      // The recipient rsk address balance is increased by the pegin value
      const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
      const expectedRskRecipientBalancesInWeisBN = new BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)).to.be.true;

    });

    it('should do legacy pegin with multiple inputs from different accounts and one output to the federation with value exactly minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo1 = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const senderRecipientInfo2 = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSender1AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo1.btcSenderAddressInfo.address);
      const initialSender2AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo2.btcSenderAddressInfo.address);

      const sender1PeginValueInSatoshis = minimumPeginValueInSatoshis;
      const sender2PeginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginValueInSatoshis = sender1PeginValueInSatoshis + sender2PeginValueInSatoshis;

      const sender1UtxosInfo = await btcTxHelper.selectSpendableUTXOsFromAddress(senderRecipientInfo1.btcSenderAddressInfo.address, Number(satoshisToBtc(sender1PeginValueInSatoshis)));
      const sender2UtxosInfo = await btcTxHelper.selectSpendableUTXOsFromAddress(senderRecipientInfo2.btcSenderAddressInfo.address, Number(satoshisToBtc(sender2PeginValueInSatoshis)));

      const sender1ChangeInSatoshis = Number(btcToSatoshis(sender1UtxosInfo.change));
      const sender2ChangeInSatoshis = Number(btcToSatoshis(sender2UtxosInfo.change));

      const tx = new bitcoinJsLib.Transaction();

      // Adding inputs
      addInputs(tx, sender1UtxosInfo.utxos);
      addInputs(tx, sender2UtxosInfo.utxos);

      // Adding output to federation
      addOutput(tx, federationAddress, peginValueInSatoshis);

      // Adding change outputs
      addOutput(tx, senderRecipientInfo1.btcSenderAddressInfo.address, sender1ChangeInSatoshis - btcFeeInSatoshis);
      addOutput(tx, senderRecipientInfo2.btcSenderAddressInfo.address, sender2ChangeInSatoshis - btcFeeInSatoshis);

      const sendersPrivateKeys = [senderRecipientInfo1.btcSenderAddressInfo.privateKey, senderRecipientInfo2.btcSenderAddressInfo.privateKey]
      const signedTx = await btcTxHelper.nodeClient.signTransaction(tx.toHex(), [], sendersPrivateKeys);

      // Act

      // Sending the pegin and ensuring the pegin is registered
      const btcPeginTxHash = await btcTxHelper.nodeClient.sendTransaction(signedTx);

      // Assert

      // Since we are not using `sendPegin` here, we need to do some extra steps before ensuring the pegin is registered.
      await ensurePeginIsPushed(btcPeginTxHash);

      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, senderRecipientInfo1.rskRecipientRskAddressInfo.address, peginValueInSatoshis);

      await assert2wpBalancesAfterSuccessfulPegin(initial2wpBalances, peginValueInSatoshis);

      // The senders should have their balances reduced by the amount sent to the federation and the fee.
      const finalSender1AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo1.btcSenderAddressInfo.address);
      expect(finalSender1AddressBalanceInSatoshis).to.be.equal(initialSender1AddressBalanceInSatoshis - sender1PeginValueInSatoshis - btcFeeInSatoshis);

      const finalSender2AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo2.btcSenderAddressInfo.address);
      expect(finalSender2AddressBalanceInSatoshis).to.be.equal(initialSender2AddressBalanceInSatoshis - sender2PeginValueInSatoshis - btcFeeInSatoshis);

       // Only the first sender should have the total amount in rsk since in legacy pegins the rsk address is derived from the first input.
      const finalRskRecipient1BalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo1.rskRecipientRskAddressInfo.address);
      const expectedRskRecipient1BalanceInWeisBN = rskTxHelper.getClient().utils.BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipient1BalanceInWeisBN.eq(expectedRskRecipient1BalanceInWeisBN)).to.be.true;

      // The second sender should have 0 balance in rsk.
      const finalRskRecipient2BalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo2.rskRecipientRskAddressInfo.address);
      expect(finalRskRecipient2BalanceInWeisBN.eq(new BN('0'))).to.be.true;

    });

    it('should do legacy pegin with multiple inputs from different accounts and two outputs to the federation with value exactly minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo1 = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const senderRecipientInfo2 = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSender1AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo1.btcSenderAddressInfo.address);
      const initialSender2AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo2.btcSenderAddressInfo.address);

      const sender1PeginValueInSatoshis = minimumPeginValueInSatoshis;
      const sender2PeginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginValueInSatoshis = sender1PeginValueInSatoshis + sender2PeginValueInSatoshis;

      const sender1UtxosInfo = await btcTxHelper.selectSpendableUTXOsFromAddress(senderRecipientInfo1.btcSenderAddressInfo.address, Number(satoshisToBtc(sender1PeginValueInSatoshis)));
      const sender2UtxosInfo = await btcTxHelper.selectSpendableUTXOsFromAddress(senderRecipientInfo2.btcSenderAddressInfo.address, Number(satoshisToBtc(sender2PeginValueInSatoshis)));

      const sender1ChangeInSatoshis = Number(btcToSatoshis(sender1UtxosInfo.change));
      const sender2ChangeInSatoshis = Number(btcToSatoshis(sender2UtxosInfo.change));

      const tx = new bitcoinJsLib.Transaction();

      // Adding inputs
      addInputs(tx, sender1UtxosInfo.utxos);
      addInputs(tx, sender2UtxosInfo.utxos);

      // Adding 2 outputs to the federation
      addOutput(tx, federationAddress, sender1PeginValueInSatoshis);
      addOutput(tx, federationAddress, sender2PeginValueInSatoshis);

      // Adding change outputs
      addOutput(tx, senderRecipientInfo1.btcSenderAddressInfo.address, sender1ChangeInSatoshis - btcFeeInSatoshis);
      addOutput(tx, senderRecipientInfo2.btcSenderAddressInfo.address, sender2ChangeInSatoshis - btcFeeInSatoshis);

      const sendersPrivateKeys = [senderRecipientInfo1.btcSenderAddressInfo.privateKey, senderRecipientInfo2.btcSenderAddressInfo.privateKey];

      const signedTx = await btcTxHelper.nodeClient.signTransaction(tx.toHex(), [], sendersPrivateKeys);

      // Act

      const btcPeginTxHash = await btcTxHelper.nodeClient.sendTransaction(signedTx);
      // Assert

      // Since we are not using `sendPegin` here, we need to do some extra steps before ensuring the pegin is registered.
      const expectedCountOfThisPeginUtxosInTheBridge = 2;
      await ensurePeginIsPushed(btcPeginTxHash, expectedCountOfThisPeginUtxosInTheBridge);

      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, senderRecipientInfo1.rskRecipientRskAddressInfo.address, peginValueInSatoshis);

      await assert2wpBalancesAfterSuccessfulPegin(initial2wpBalances, peginValueInSatoshis);

      // The senders should have their balances reduced by the amount sent to the federation and the fee
      const finalSender1AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo1.btcSenderAddressInfo.address);
      expect(finalSender1AddressBalanceInSatoshis).to.be.equal(initialSender1AddressBalanceInSatoshis - sender1PeginValueInSatoshis - btcFeeInSatoshis);

      const finalSender2AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo2.btcSenderAddressInfo.address);
      expect(finalSender2AddressBalanceInSatoshis).to.be.equal(initialSender2AddressBalanceInSatoshis - sender2PeginValueInSatoshis - btcFeeInSatoshis);

       // Only the first sender should have the total amount in rsk since in legacy pegins the rsk address is derived from the first input.
      const finalRskRecipient1BalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo1.rskRecipientRskAddressInfo.address);
      const expectedFinalRskRecipient1BalanceInWeisBN = rskTxHelper.getClient().utils.BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipient1BalanceInWeisBN.eq(expectedFinalRskRecipient1BalanceInWeisBN)).to.be.true;

      // Other senders should have 0 balance in rsk.
      const finalRskRecipient2BalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo2.rskRecipientRskAddressInfo.address);
      expect(finalRskRecipient2BalanceInWeisBN.eq(new BN('0'))).to.be.true;

    });

    it('should do a basic pegin v1 with the exact minimum value', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('');

      // Act

      const peginV1Data = [Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex')];

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis), peginV1Data);

      // Assert

      const expectedCountOfThisPeginUtxosInTheBridge = 1;
      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash, expectedCountOfThisPeginUtxosInTheBridge);

      const expectedPeginProtocolVersion = '1';
      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, peginV1RskRecipientAddress, peginValueInSatoshis, expectedPeginProtocolVersion);

      await assert2wpBalancesAfterSuccessfulPegin(initial2wpBalances, peginValueInSatoshis);

      // The sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);

      // The sender derived rsk address rsk address balance is unchanged
      const finalSenderDerivedRskAddressBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
      expect(finalSenderDerivedRskAddressBalanceInWeisBN.eq(new BN('0'))).to.be.true;

      // The pegin v1 rsk recipient address has the funds
      const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(peginV1RskRecipientAddress);
      const expectedFinalRskRecipientBalanceInWeisBN = rskTxHelper.getClient().utils.BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedFinalRskRecipientBalanceInWeisBN)).to.be.true;

    });

    it('should reject a legacy pegin with the value exactly below minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const initialFederationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      // The minimum pegin value minus 1 satoshis
      const peginValueInSatoshis = minimumPeginValueInSatoshis - 1;

      // Act

      const blockNumberBeforePegin = await rskTxHelper.getBlockNumber();

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis));
      // Funds of a pegin with value below minimum are lost. But calling triggerRelease here to ensure that nothing will be refunded.
      await triggerRelease(rskTxHelpers, btcTxHelper);

      // Assert

      // The btc pegin tx is not marked as processed by the bridge
      await assertPeginTxHashNotProcessed(btcPeginTxHash);

      await assert2wpBalancesPeginRejectedBelowMinimum(initial2wpBalances, peginValueInSatoshis);

      await assertExpectedRejectedPeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_REJECTION_REASONS.INVALID_AMOUNT);

      // The federation balance is increased by the pegin value
      const finalFederationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
      expect(finalFederationAddressBalanceInSatoshis).to.be.equal(initialFederationAddressBalanceInSatoshis + peginValueInSatoshis);

      // The sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);

      // The recipient rsk address balance is zero
      const finalRskRecipientBalance = Number(await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address));
      expect(finalRskRecipientBalance).to.be.equal(0);

    });

  });

}

const assertExpectedPeginBtcEventIsEmitted = async (btcPeginTxHash, rskRecipientAddress, peginValueInSatoshis, expectedPeginProtocolVersion) => {
  const recipientRskAddressChecksummed = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(rskRecipientAddress));
  const expectedEvent = createExpectedPeginBtcEvent(PEGIN_EVENTS.PEGIN_BTC, recipientRskAddressChecksummed, btcPeginTxHash, peginValueInSatoshis, expectedPeginProtocolVersion);
  const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
  const peginBtcEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, btcTxHashProcessedHeight);
  expect(peginBtcEvent).to.be.deep.equal(expectedEvent);
};

const assertExpectedRejectedPeginEventIsEmitted = async (btcPeginTxHash, blockNumberBeforePegin, rejectionReason) => {
  const expectedEvent = createExpectedRejectedPeginEvent(PEGIN_EVENTS.REJECTED_PEGIN, btcPeginTxHash, rejectionReason);
  const currentBlockNumber = await rskTxHelper.getBlockNumber();
  const rejectedPeginEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, blockNumberBeforePegin, currentBlockNumber);
  expect(rejectedPeginEvent).to.be.deep.equal(expectedEvent);
};

/**
 * Gets the final 2wp balances (Federation, Bridge utxos and bridge rsk balances) and compares them to the `initial2wpBalances` to assert the expected values based on a successful pegin.
 * Checks that after a successful pegin, the federation and Bridge utxos balances are increased and the Bridge rsk balance is decreased, by the `peginValueInSatoshis` amount.
 * @param {{federationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}} initial2wpBalances
 * @param {number} peginValueInSatoshis the value of the pegin in satoshis by which the 2wp balances are expected to be updated
 * @returns {Promise<void>}
 */
const assert2wpBalancesAfterSuccessfulPegin = async (initial2wpBalances, peginValueInSatoshis) => {
  
  const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);

  expect(final2wpBalances.federationAddressBalanceInSatoshis).to.be.equal(initial2wpBalances.federationAddressBalanceInSatoshis + peginValueInSatoshis);

  expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(initial2wpBalances.bridgeUtxosBalanceInSatoshis + peginValueInSatoshis);

  const expectedFinalBridgeBalancesInWeisBN = initial2wpBalances.bridgeBalanceInWeisBN.sub(new BN(satoshisToWeis(peginValueInSatoshis)));
  expect(final2wpBalances.bridgeBalanceInWeisBN.eq(expectedFinalBridgeBalancesInWeisBN)).to.be.true;

};

/**
* Gets the final 2wp balances (Federation, Bridge utxos and bridge rsk balances) and compares them to the `initial2wpBalances` to assert the expected values based on a rejected pegin due to low amount.
* Checks that after a rejected pegin because of a low amount (below minimum), the federation balance is increased by the peginValueInSatoshis amount, because the funds will not be refunded, while the Bridge utxos and Bridge rsk balances stay intact.
* @param {{federationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}} initial2wpBalances
* @param {number} peginValueInSatoshis the value of the pegin in satoshis by which only the federation balance is to be increased.
* @returns {Promise<void>}
*/
const assert2wpBalancesPeginRejectedBelowMinimum = async (initial2wpBalances, peginValueInSatoshis) => {
 
 const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);

 expect(final2wpBalances.federationAddressBalanceInSatoshis).to.be.equal(initial2wpBalances.federationAddressBalanceInSatoshis + peginValueInSatoshis);

 expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(initial2wpBalances.bridgeUtxosBalanceInSatoshis);

 expect(final2wpBalances.bridgeBalanceInWeisBN.eq(initial2wpBalances.bridgeBalanceInWeisBN)).to.be.true;

};

const addInputs = (tx, utxos) => {
  utxos.forEach(utxo => {
    tx.addInput(Buffer.from(utxo.txid, 'hex').reverse(), utxo.vout);
  });
};

const ensurePeginIsPushed = async (btcPeginTxHash, expectedUtxosCount = 1) => {
  await waitForBitcoinMempoolToGetTxs(btcTxHelper, btcPeginTxHash);
  await mineForPeginRegistration(rskTxHelper, btcTxHelper);
  await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash, expectedUtxosCount);
};

const addOutput = (tx, address, outputValueInSatoshis) => {
  if(outputValueInSatoshis > 0) {
    tx.addOutput(
      bitcoinJsLib.address.toOutputScript(address, btcTxHelper.btcConfig.network),
      outputValueInSatoshis
    );
  }
};

const assertPeginTxHashNotProcessed = async (btcPeginTxHash) => {
  const isBtcTxHashAlreadyProcessed = await bridge.methods.isBtcTxHashAlreadyProcessed(btcPeginTxHash).call();
  expect(isBtcTxHashAlreadyProcessed).to.be.false;
  const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
  expect(btcTxHashProcessedHeight).to.be.equal(-1);
};

module.exports = {
  execute,
};
