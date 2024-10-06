const expect = require('chai').expect;
const BN = require('bn.js');
const { createPeginV1TxData } = require('pegin-address-verificator');
const { getBridge } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelper, getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const { satoshisToBtc, btcToSatoshis, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { findEventInBlock, triggerRelease } = require('../rsk-utils');
const { PEGIN_REJECTION_REASONS, PEGIN_UNREFUNDABLE_REASONS, PEGOUT_EVENTS } = require("../constants");
const { sendPegin,
    ensurePeginIsRegistered,
    createSenderRecipientInfo,
    createExpectedPeginBtcEvent,
    get2wpBalances,
    createExpectedRejectedPeginEvent,
    createExpectedUnrefundablePeginEvent,
    assertRefundUtxosSameAsPeginUtxos,
} = require('../2wp-utils');
const { getBtcAddressBalanceInSatoshis } = require('../btc-utils');
const { ensure0x } = require('../utils');

let btcTxHelper;
let rskTxHelpers;
let rskTxHelper;
let bridge;
let federationAddress;
let minimumPeginValueInSatoshis;
let btcFeeInSatoshis;

const execute = (description, getRskHost) => {

  describe(description, () => {

    before(async () => {

      btcTxHelper = getBtcClient();
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = getRskTransactionHelper(getRskHost());
      bridge = getBridge(rskTxHelper.getClient());

      federationAddress = await bridge.methods.getFederationAddress().call();
      minimumPeginValueInSatoshis = Number(await bridge.methods.getMinimumLockTxValue().call());
      btcFeeInSatoshis = Number(btcToSatoshis(await btcTxHelper.getFee()));

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

    it('should do a basic pegin v1 with the exact minimum value', async () => {

      // Arrange
  
      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('successfulPeginV1');
  
      // Act
  
      const peginV1Data = [Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex')];
  
      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)), peginV1Data);
  
      // Assert
  
      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
  
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
      const expectedFinalRskRecipientBalanceInWeisBN = new BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedFinalRskRecipientBalanceInWeisBN)).to.be.true;
  
    });

    it('should reject and not refund a legacy pegin with the value exactly below minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const initialFederationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      // The minimum pegin value minus 1 satoshis
      const peginValueInSatoshis = minimumPeginValueInSatoshis - 1;

      // Act

      const blockNumberBeforePegin = await rskTxHelper.getBlockNumber();

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)));
      // Funds of a pegin with value below minimum are lost. But calling triggerRelease here to ensure that nothing will be refunded.
      await triggerRelease(rskTxHelpers, btcTxHelper);

      // Assert

      // The btc pegin tx is not marked as processed by the bridge
      await assertPeginTxHashNotProcessed(btcPeginTxHash);

      await assert2wpBalancesPeginRejectedNoRefund(initial2wpBalances, peginValueInSatoshis);

      await assertExpectedRejectedPeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_REJECTION_REASONS.INVALID_AMOUNT);
      await assertExpectedUnrefundablePeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_UNREFUNDABLE_REASONS.INVALID_AMOUNT);

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

    it('should reject and not refund a basic pegin v1 with value exactly below minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      // The minimum pegin value minus 1 satoshis
      const peginValueInSatoshis = minimumPeginValueInSatoshis - 1;
      
      const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('rejectedPeginV1');

      // Act

      const peginV1Data = [Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex')];

      const blockNumberBeforePegin = await rskTxHelper.getBlockNumber();

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis), peginV1Data);
      // Funds of a pegin with value below minimum are lost. But calling triggerRelease here to ensure that nothing will be refunded.
      await triggerRelease(rskTxHelpers, btcTxHelper);

      // Assert

      // The btc pegin tx is not marked as processed by the bridge
      await assertPeginTxHashNotProcessed(btcPeginTxHash);

      await assert2wpBalancesPeginRejectedNoRefund(initial2wpBalances, peginValueInSatoshis);

      await assertExpectedRejectedPeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_REJECTION_REASONS.INVALID_AMOUNT);
      await assertExpectedUnrefundablePeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_UNREFUNDABLE_REASONS.INVALID_AMOUNT);

      // The sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);

      // The sender derived rsk address rsk address balance is unchanged
      const finalSenderDerivedRskAddressBalance = Number(await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address));
      expect(finalSenderDerivedRskAddressBalance).to.be.equal(0);

      // The pegin v1 rsk recipient address is also zero
      const finalRskRecipientBalance = Number(await rskTxHelper.getBalance(peginV1RskRecipientAddress));
      expect(finalRskRecipientBalance).to.be.equal(0);

    });

    it('should reject and refund a legacy pegin from a multisig account with the value exactly minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const multisigSenderAddressInfo = await btcTxHelper.generateMultisigAddress(3, 2, 'legacy');
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      await btcTxHelper.fundAddress(multisigSenderAddressInfo.address, Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis)));

      // Act

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, multisigSenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)));

      // Assert

      await assertBtcPeginTxHashProcessed(btcPeginTxHash);

      // The rejected_pegin event is emitted with the expected values
      const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
      await assertExpectedRejectedPeginEventIsEmitted(btcPeginTxHash, btcTxHashProcessedHeight, PEGIN_REJECTION_REASONS.LEGACY_PEGIN_MULTISIG_SENDER);
      await assertExpectedReleaseRequestedEventIsEmitted(btcTxHashProcessedHeight, peginValueInSatoshis);

      // Expecting the multisig btc sender balance to be zero after the pegin.
      const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(btcTxHelper, multisigSenderAddressInfo.address);
      expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

      // We are expecting a refund pegout to go through. So, let's push it.
      await triggerRelease(rskTxHelpers, btcTxHelper);

      await assert2wpBalanceIsUnchanged(initial2wpBalances);

      // Finally, the multisig btc sender address should have received the funds back minus certain fee.
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, multisigSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.above(peginValueInSatoshis - btcFeeInSatoshis).and.below(peginValueInSatoshis)

    });

    it('should reject and not refund a legacy pegin from a multisig account with the value exactly below minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const multisigSenderAddressInfo = await btcTxHelper.generateMultisigAddress(3, 2, 'legacy');
      const peginValueInSatoshis = minimumPeginValueInSatoshis - 1;
      await btcTxHelper.fundAddress(multisigSenderAddressInfo.address, Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis)));

      // Act

      const blockNumberBeforePegin = await rskTxHelper.getBlockNumber();

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, multisigSenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)));

      // Assert

      await assertPeginTxHashNotProcessed(btcPeginTxHash);

      await assertExpectedRejectedPeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_REJECTION_REASONS.INVALID_AMOUNT);
      await assertExpectedUnrefundablePeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_UNREFUNDABLE_REASONS.INVALID_AMOUNT);

      // Expecting the multisig btc sender balance to be zero after the pegin.
      const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(btcTxHelper, multisigSenderAddressInfo.address);
      expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

      // To ensure no refund is made, let's try to push any possible refund pegout.
      await triggerRelease(rskTxHelpers, btcTxHelper);

      await assert2wpBalancesPeginRejectedNoRefund(initial2wpBalances, peginValueInSatoshis);

      // Finally, the multisig btc sender address should not have received the funds back.
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, multisigSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(senderAddressBalanceAfterPegin);

    });

    it('should do a pegin v1 from multisig with the exact minimum value', async () => {

      // Arrange
  
      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const multisigSenderAddressInfo = await btcTxHelper.generateMultisigAddress(3, 2, 'legacy');
      await btcTxHelper.fundAddress(multisigSenderAddressInfo.address, Number(satoshisToBtc(minimumPeginValueInSatoshis + btcFeeInSatoshis)));
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, multisigSenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('successfulPeginV1FromMultisig');
  
      // Act
  
      const peginV1Data = [Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex')];
  
      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, multisigSenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)), peginV1Data);
  
      // Assert

      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
  
      const expectedPeginProtocolVersion = '1';
      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, peginV1RskRecipientAddress, peginValueInSatoshis, expectedPeginProtocolVersion);
  
      await assert2wpBalancesAfterSuccessfulPegin(initial2wpBalances, peginValueInSatoshis);
  
      // The sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, multisigSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);
  
      // The pegin v1 rsk recipient address has the funds
      const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(peginV1RskRecipientAddress);
      const expectedFinalRskRecipientBalanceInWeisBN = new BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedFinalRskRecipientBalanceInWeisBN)).to.be.true;
  
    });


    it('should do a pegin v1 from bech32 sender with the exact minimum value', async () => {

      // Arrange
  
      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const bech32SenderAddressInfo = await btcTxHelper.generateBtcAddress('bech32');
      await btcTxHelper.fundAddress(bech32SenderAddressInfo.address, Number(satoshisToBtc(minimumPeginValueInSatoshis + btcFeeInSatoshis)));
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, bech32SenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('successfulPeginV1FromBech32');
  
      // Act
  
      const peginV1Data = [Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex')];
  
      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, bech32SenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)), peginV1Data);
  
      // Assert
  
      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
  
      const expectedPeginProtocolVersion = '1';
      await assertExpectedPeginBtcEventIsEmitted(btcPeginTxHash, peginV1RskRecipientAddress, peginValueInSatoshis, expectedPeginProtocolVersion);
  
      await assert2wpBalancesAfterSuccessfulPegin(initial2wpBalances, peginValueInSatoshis);
  
      // The sender address balance is decreased by the pegin value and the btc fee
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, bech32SenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis);
  
      // The pegin v1 rsk recipient address has the funds
      const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(peginV1RskRecipientAddress);
      const expectedFinalRskRecipientBalanceInWeisBN = new BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedFinalRskRecipientBalanceInWeisBN)).to.be.true;
  
    });

    it('should do a basic pegin v1 with btc refund address and the exact minimum value', async () => {

      // Arrange
  
      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('successfulPeginV1WithBtcRefundAddress');
  
      // Act
  
      const peginV1Data = [Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress, senderRecipientInfo.btcSenderAddressInfo.address), 'hex')];
  
      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)), peginV1Data);
  
      // Assert
  
      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
  
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
      const expectedFinalRskRecipientBalanceInWeisBN = new BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedFinalRskRecipientBalanceInWeisBN)).to.be.true;
  
    });

    it('should reject and not refund a legacy pegin from a bech32 sender with the value exactly minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const bech32SenderAddressInfo = await btcTxHelper.generateBtcAddress('bech32');
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      await btcTxHelper.fundAddress(bech32SenderAddressInfo.address, Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis)));

      // Act

      const blockNumberBeforePegin = await rskTxHelper.getBlockNumber();

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, bech32SenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)));

      // Assert

      // To ensure no refund is made, let's try to push any possible refund pegout.
      await triggerRelease(rskTxHelpers, btcTxHelper);

      await assertPeginTxHashNotProcessed(btcPeginTxHash);

      // Two events are emitted in this scenario: rejected_pegin and unrefundable_pegin.
      await assertExpectedRejectedPeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_REJECTION_REASONS.LEGACY_PEGIN_UNDETERMINED_SENDER);
      await assertExpectedUnrefundablePeginEventIsEmitted(btcPeginTxHash, blockNumberBeforePegin, PEGIN_UNREFUNDABLE_REASONS.LEGACY_PEGIN_UNDETERMINED_SENDER);

      // Expecting the multisig btc sender balance to be zero after the pegin.
      const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(btcTxHelper, bech32SenderAddressInfo.address);
      expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

      // To ensure no refund is made, let's try to push any possible refund pegout.
      await triggerRelease(rskTxHelpers, btcTxHelper);

      await assert2wpBalancesPeginRejectedNoRefund(initial2wpBalances, peginValueInSatoshis);

      // Finally, the multisig btc sender address should not have received the funds back.
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, bech32SenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(senderAddressBalanceAfterPegin);

    });

    it('should reject and refund pegin with multiple OP_RETURN outputs for RSK with value exactly minimum', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'p2sh-segwit', Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis)));
      const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('rejectedPeginWithMultipleOpReturnOutputs');

      const data = [];
      data.push(Buffer.from(createPeginV1TxData(senderRecipientInfo.rskRecipientRskAddressInfo.address), 'hex'));
      data.push(Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex'));

      // Act

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis), data);

      // Assert

      // Expecting the btc sender balance to be zero right after the pegin.
      const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);
      
      // We are expecting a refund pegout to go through. So, let's push it.
      await triggerRelease(rskTxHelpers, btcTxHelper);
      
      await assertBtcPeginTxHashProcessed(btcPeginTxHash);

      // The rejected_pegin and released_requested events are emitted with the expected values
      const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
      await assertExpectedRejectedPeginEventIsEmitted(btcPeginTxHash, btcTxHashProcessedHeight, PEGIN_REJECTION_REASONS.PEGIN_V1_INVALID_PAYLOAD_REASON);
      await assertExpectedReleaseRequestedEventIsEmitted(btcTxHashProcessedHeight, peginValueInSatoshis);

      await assert2wpBalanceIsUnchanged(initial2wpBalances);

      // Finally, the btc sender address should have received the funds back minus certain fee.
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalSenderAddressBalanceInSatoshis).to.be.above(peginValueInSatoshis - btcFeeInSatoshis).and.below(peginValueInSatoshis)
      
      // Check the same UTXOs used for the peg-in tx were used for the reject tx
      await assertRefundUtxosSameAsPeginUtxos(rskTxHelper, btcTxHelper, btcPeginTxHash, senderRecipientInfo.btcSenderAddressInfo.address);

    });

    it('should do a pegin v1 with multiple OP_RETURN outputs but only one for RSK and the exact minimum value', async () => {

      // Arrange

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const peginValueInSatoshis = minimumPeginValueInSatoshis;
      const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('successfulPeginV1Multiple_OP_RETURN');

      // Act

      const peginV1Data = [];
      peginV1Data.push(Buffer.from('some random data', 'hex'));
      peginV1Data.push(Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex'));
      peginV1Data.push(Buffer.from('some more random data', 'hex'));

      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, Number(satoshisToBtc(peginValueInSatoshis)), peginV1Data);

      // Assert

      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

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
      const expectedFinalRskRecipientBalanceInWeisBN = new BN(satoshisToWeis(peginValueInSatoshis));
      expect(finalRskRecipientBalanceInWeisBN.eq(expectedFinalRskRecipientBalanceInWeisBN)).to.be.true;

    });
  
  });

};

const assertExpectedPeginBtcEventIsEmitted = async (btcPeginTxHash, rskRecipientAddress, peginValueInSatoshis, expectedPeginProtocolVersion = '0') => {
  const recipient1RskAddressChecksumed = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(rskRecipientAddress));
  const expectedEvent = createExpectedPeginBtcEvent(recipient1RskAddressChecksumed, btcPeginTxHash, peginValueInSatoshis, expectedPeginProtocolVersion);
  const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
  const peginBtcEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, btcTxHashProcessedHeight);
  expect(peginBtcEvent).to.be.deep.equal(expectedEvent);
};

const assertExpectedRejectedPeginEventIsEmitted = async (btcPeginTxHash, blockNumberBeforePegin, rejectionReason) => {
  const expectedEvent = createExpectedRejectedPeginEvent(btcPeginTxHash, rejectionReason);
  const currentBlockNumber = await rskTxHelper.getBlockNumber();
  const rejectedPeginEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, blockNumberBeforePegin, currentBlockNumber, foundEvent =>  foundEvent.arguments.btcTxHash === ensure0x(btcPeginTxHash));
  expect(rejectedPeginEvent).to.be.deep.equal(expectedEvent);
};

const assertExpectedUnrefundablePeginEventIsEmitted = async (btcPeginTxHash, blockNumberBeforePegin, rejectionReason) => {
  const expectedEvent = createExpectedUnrefundablePeginEvent(btcPeginTxHash, rejectionReason);
  const currentBlockNumber = await rskTxHelper.getBlockNumber();
  const rejectedPeginEvent = await findEventInBlock(rskTxHelper, expectedEvent.name, blockNumberBeforePegin, currentBlockNumber, foundEvent => {
    return foundEvent.arguments.btcTxHash === ensure0x(btcPeginTxHash);
  });
  expect(rejectedPeginEvent).to.be.deep.equal(expectedEvent);
};

const assertExpectedReleaseRequestedEventIsEmitted = async (btcTxHashProcessedHeight, peginValueInSatoshis) => {
  const releaseCreatedEvent = await findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_REQUESTED.name, btcTxHashProcessedHeight);
  expect(releaseCreatedEvent).to.not.be.null;
  expect(releaseCreatedEvent.signature).to.be.equal(PEGOUT_EVENTS.RELEASE_REQUESTED.signature);
  expect(releaseCreatedEvent.arguments.rskTxHash).to.not.be.undefined;
  expect(releaseCreatedEvent.arguments.btcTxHash).to.not.be.undefined;
  expect(Number(releaseCreatedEvent.arguments.amount)).to.be.equal(peginValueInSatoshis);
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
* Gets the final 2wp balances (Federation, Bridge utxos and bridge rsk balances) and compares them to the `initial2wpBalances` to assert the expected values based on a rejected pegin with no refund.
* Checks that after a rejected pegin with no refund (low amount, segwit sender), the federation balance is increased by the peginValueInSatoshis amount, while the Bridge utxos and Bridge rsk balances stay intact.
* @param {{federationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}} initial2wpBalances
* @param {number} peginValueInSatoshis the value of the pegin in satoshis by which only the federation balance is expected to have increased.
* @returns {Promise<void>}
*/
const assert2wpBalancesPeginRejectedNoRefund = async (initial2wpBalances, peginValueInSatoshis) => {

  const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
 
  expect(final2wpBalances.federationAddressBalanceInSatoshis).to.be.equal(initial2wpBalances.federationAddressBalanceInSatoshis + peginValueInSatoshis);
 
  expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(initial2wpBalances.bridgeUtxosBalanceInSatoshis);
 
  expect(final2wpBalances.bridgeBalanceInWeisBN.eq(initial2wpBalances.bridgeBalanceInWeisBN)).to.be.true;

};

const assertPeginTxHashNotProcessed = async (btcPeginTxHash) => {
  const isBtcTxHashAlreadyProcessed = await bridge.methods.isBtcTxHashAlreadyProcessed(btcPeginTxHash).call();
  expect(isBtcTxHashAlreadyProcessed).to.be.false;
  const btcTxHashProcessedHeight = Number(await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call());
  expect(btcTxHashProcessedHeight).to.be.equal(-1);
};

const assert2wpBalanceIsUnchanged = async (initial2wpBalances) => {
  const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
  expect(final2wpBalances).to.be.deep.equal(initial2wpBalances);
};

const assertBtcPeginTxHashProcessed = async (btcPeginTxHash) => {
  const isBtcTxHashAlreadyProcessed = await bridge.methods.isBtcTxHashAlreadyProcessed(btcPeginTxHash).call();
  expect(isBtcTxHashAlreadyProcessed).to.be.true;
};

module.exports = {
  execute,
};
