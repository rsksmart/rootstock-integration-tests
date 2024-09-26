const expect = require('chai').expect;
const BN = require('bn.js');
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
    get2wpBalances,
} = require('../2wp-utils');
const { ensure0x } = require('../utils');
const { getBtcAddressBalanceInSatoshis, waitForBitcoinMempoolToGetTxs } = require('../btc-utils');
const bitcoinJsLib = require('bitcoinjs-lib');

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let bridge;
let federationAddress;
let minimumPeginValueInSatoshis;
let btcFeeInSatoshis;

const getSenderUtxosInfo = async (senderInfo, btcSenderAmountToSendToFed) => {
  return await btcTxHelper.selectSpendableUTXOsFromAddress(senderInfo.btcSenderAddressInfo.address, btcSenderAmountToSendToFed);
};

const addInputs = (tx, senderUtxosInfo) => {
  senderUtxosInfo.utxos.forEach(utxo => {
    tx.addInput(Buffer.from(utxo.txid, 'hex').reverse(), utxo.vout);
  });
};

const addChangeOutputs = (tx, changeAddress, changeInSatoshis) => {
  if(changeInSatoshis > 0) {
    tx.addOutput(
      bitcoinJsLib.address.toOutputScript(changeAddress, btcTxHelper.btcConfig.network),
      changeInSatoshis - btcFeeInSatoshis
    );
  }
};

const ensurePeginIsPushed = async (btcPeginTxHash, expectedUtxosCount = 1) => {
  await waitForBitcoinMempoolToGetTxs(btcTxHelper, btcPeginTxHash);
  await mineForPeginRegistration(rskTxHelper, btcTxHelper);
  await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash, expectedUtxosCount);
};

const addOutputToFed = (tx, outputValueInSatoshis) => {
  tx.addOutput(
    bitcoinJsLib.address.toOutputScript(federationAddress, btcTxHelper.btcConfig.network),
    outputValueInSatoshis
  );
};

/**
 * Signs the btc transaction with the private keys of the senders
 * @param {bitcoinJsLib.Transaction()} senderRecipientInfo 
 * @param {...any} senderRecipientInfo 
 * @returns {Promise<string>} the raw btc transaction in hex string
 */
const signPeginTransaction = async (tx, ...senderRecipientInfo) => {
  const sendersPrivateKeys = senderRecipientInfo.map(senderRecipientInfo => senderRecipientInfo.btcSenderAddressInfo.privateKey);
  const signedTx = await btcTxHelper.nodeClient.signTransaction(tx.toHex(), [], sendersPrivateKeys);
  return signedTx;
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

      const initial2wpBalances = await get2wpInitialBalances();
      const sender1RecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const sender2RecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSender1AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, sender1RecipientInfo.btcSenderAddressInfo.address);
      const initialSender2AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, sender2RecipientInfo.btcSenderAddressInfo.address);

      const sender1PeginValueInSatoshis = minimumPeginValueInSatoshis;
      const sender2PeginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginValueInSatoshis = sender1PeginValueInSatoshis + sender2PeginValueInSatoshis;

      const sender1UtxosInfo = await getSenderUtxosInfo(sender1RecipientInfo, satoshisToBtc(sender1PeginValueInSatoshis));
      const sender2UtxosInfo = await getSenderUtxosInfo(sender2RecipientInfo, satoshisToBtc(sender2PeginValueInSatoshis));

      const sender1ChangeInSatoshis = btcToSatoshis(sender1UtxosInfo.change);
      const sender2ChangeInSatoshis = btcToSatoshis(sender2UtxosInfo.change);

      const tx = new bitcoinJsLib.Transaction();

      // Adding inputs
      addInputs(tx, sender1UtxosInfo);
      addInputs(tx, sender2UtxosInfo);

      // Adding output to federation
      addOutputToFed(tx, peginValueInSatoshis);

      // Adding change outputs
      addChangeOutputs(tx, sender1RecipientInfo.btcSenderAddressInfo.address, sender1ChangeInSatoshis);
      addChangeOutputs(tx, sender2RecipientInfo.btcSenderAddressInfo.address, sender2ChangeInSatoshis);

      const signedTx = await signPeginTransaction(tx, sender1RecipientInfo, sender2RecipientInfo);

      // Act

      // Sending the pegin and ensuring the pegin is registered
      const btcPeginTxHash = await btcTxHelper.nodeClient.sendTransaction(signedTx);

      // Assert

      // Since we are not using `sendPegin` here, we need to do some extra steps before ensuring the pegin is registered.
      await ensurePeginIsPushed(btcPeginTxHash);

      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, sender1RecipientInfo.rskRecipientRskAddressInfo.address, peginValueInSatoshis);

      await assertSuccessfulPegin2wpFinalBalances(initial2wpBalances, peginValueInSatoshis);

      // The senders should have their balances reduced by the amount sent to the federation and the fee.
      const finalSender1AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, sender1RecipientInfo.btcSenderAddressInfo.address);
      expect(finalSender1AddressBalanceInSatoshis).to.be.equal(initialSender1AddressBalanceInSatoshis - sender1PeginValueInSatoshis - btcFeeInSatoshis);

      const finalSender2AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, sender2RecipientInfo.btcSenderAddressInfo.address);
      expect(finalSender2AddressBalanceInSatoshis).to.be.equal(initialSender2AddressBalanceInSatoshis - sender2PeginValueInSatoshis - btcFeeInSatoshis);

       // Only the first sender should have the total amount in rsk since in legacy pegins the rsk address is derived from the first input.
      const finalRskRecipient1BalanceInWeisBN = await rskTxHelper.getBalance(sender1RecipientInfo.rskRecipientRskAddressInfo.address);
      const expectedRskRecipient1BalanceInWeisBN = rskTxHelper.getClient().utils.BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipient1BalanceInWeisBN).to.be.equal(expectedRskRecipient1BalanceInWeisBN);

      // The second sender should have 0 balance in rsk.
      const finalRskRecipient2BalanceInWeisBN = Number(await rskTxHelper.getBalance(sender2RecipientInfo.rskRecipientRskAddressInfo.address));
      expect(finalRskRecipient2BalanceInWeisBN).to.be.equal(0);

    });

  });

}

const assertExpectedPeginBtcEventIsEmitted = async (btcPeginTxHash, rskRecipientAddress, peginValueInSatoshis) => {
  const recipient1RskAddressChecksumed = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(rskRecipientAddress));
  const expectedEvent = createExpectedPeginBtcEvent(PEGIN_EVENTS.PEGIN_BTC, recipient1RskAddressChecksumed, btcPeginTxHash, peginValueInSatoshis);
  const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
  const peginBtcEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, btcTxHashProcessedHeight);
  expect(peginBtcEvent).to.be.deep.equal(expectedEvent);
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

module.exports = {
  execute,
};
