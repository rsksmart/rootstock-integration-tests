const expect = require('chai').expect;
const BN = require('bn.js');
const { createPeginV1TxData } = require('pegin-address-verificator');
const { getBridge } = require('../precompiled-abi-forks-util');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelper, getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const { satoshisToBtc, btcToSatoshis, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { findEventInBlock, triggerRelease, getPegoutEventsInBlockRange, setFeePerKb } = require('../rsk-utils');
const {
  PEGIN_REJECTION_REASONS,
  PEGIN_UNREFUNDABLE_REASONS,
  PEGOUT_EVENTS,
  PEGIN_V1_RSKT_PREFIX_HEX,
  MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS,
  PEGOUT_REJECTION_REASONS,
} = require("../constants");
const { sendPegin,
    ensurePeginIsRegistered,
    createSenderRecipientInfo,
    createExpectedPeginBtcEvent,
    get2wpBalances,
    createExpectedRejectedPeginEvent,
    createExpectedUnrefundablePeginEvent,
    assertRefundUtxosSameAsPeginUtxos,
    sendTxToBridge,
    fundRskAccountThroughAPegin,
    createExpectedReleaseRequestRejectedEvent,
} = require('../2wp-utils');
const { getBtcAddressBalanceInSatoshis } = require('../btc-utils');
const { ensure0x, removePrefix0x } = require('../utils');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const bitcoinJsLib = require('bitcoinjs-lib');

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

    describe('Pegin tests', () => {

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

      it('should reject and refund pegin with OP_RETURN output to RSK with invalid payload with value exactly minimum', async () => {

        // Arrange

        const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
        const peginValueInSatoshis = minimumPeginValueInSatoshis;
        const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'p2sh-segwit', Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis)));
        
        const peginV1InvalidPayload = `${PEGIN_V1_RSKT_PREFIX_HEX}randomdata`;
        const peginV1Data = [Buffer.from(peginV1InvalidPayload, 'hex')];

        // Act

        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis), peginV1Data);

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

      it('should reject and refund pegin with invalid pegin v1 version with value exactly minimum', async () => {

        // Arrange

        const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
        const peginValueInSatoshis = minimumPeginValueInSatoshis;
        const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'p2sh-segwit', Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis)));
        const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed('successfulPeginV1InvalidVersion');

        const invalidPeginV1Version = '999';
        const peginV1InvalidPayload = `${PEGIN_V1_RSKT_PREFIX_HEX}${invalidPeginV1Version}${removePrefix0x(peginV1RskRecipientAddress)}`;
        const peginV1Data = [Buffer.from(peginV1InvalidPayload, 'hex')];

        // Act

        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis), peginV1Data);

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

      it('should do a basic legacy pegin using p2sh-segwit sender with the exact minimum value', async () => {

        // Arrange

        const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
        const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'p2sh-segwit');
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

    });

    it('should do a pegout with value exactly minimum', async () => {

      // Arrange

      // Create a pegin for the sender to ensure there is enough funds to pegout and because this is the natural process
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      await fundRskAccountThroughAPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo);

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const pegoutValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS;

      // Act

      const pegoutTransaction = await sendTxToBridge(rskTxHelper, new BN(satoshisToWeis(pegoutValueInSatoshis)), senderRecipientInfo.rskRecipientRskAddressInfo.address);

      // Assert

      let bridgeStateAfterPegoutCreation;

      // Callback to get the bridge state after the pegout is created
      const pegoutCreatedCallback = async () => {
        bridgeStateAfterPegoutCreation = await getBridgeState(rskTxHelper.getClient());
      };

      const callbacks = {
        pegoutCreatedCallback
      };

      await triggerRelease(rskTxHelpers, btcTxHelper, callbacks);

      // Checking all the pegout events are emitted and in order
      const blockNumberAfterPegoutRelease = await rskTxHelper.getBlockNumber();
      const pegoutsEvents = await getPegoutEventsInBlockRange(rskTxHelper, pegoutTransaction.blockNumber, blockNumberAfterPegoutRelease);
      await assertSuccessfulPegoutEventsAreEmitted(pegoutsEvents, pegoutTransaction.transactionHash, senderRecipientInfo, pegoutValueInSatoshis, bridgeStateAfterPegoutCreation);

      await assert2wpBalanceAfterSuccessfulPegout(initial2wpBalances, pegoutValueInSatoshis);

      // Assert that the sender address balance is increased by the actual pegout value
      const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const releaseBtcEvent = pegoutsEvents[pegoutsEvents.length - 1];
      const releaseBtcTransaction = bitcoinJsLib.Transaction.fromHex(removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction));
      const actualPegoutValueReceivedInSatoshis = releaseBtcTransaction.outs[0].value;
      expect(finalSenderAddressBalanceInSatoshis).to.be.equal(initialSenderAddressBalanceInSatoshis + actualPegoutValueReceivedInSatoshis);

    });

    it('should reject and refund a pegout with value exactly below minimum', async () => {

      // Arrange

      // Create a pegin for the sender to ensure there is enough funds to pegout and because this is the natural process
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      await fundRskAccountThroughAPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo);
      
      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const initialBtcRecipientAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const initialRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
      // Value exactly below minimum
      const pegoutValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS - 1;

      // Act

      const pegoutTransaction = await sendTxToBridge(rskTxHelper, new BN(satoshisToWeis(pegoutValueInSatoshis)), senderRecipientInfo.rskRecipientRskAddressInfo.address);

      // Assert

      await assertExpectedReleaseRequestRejectedEventIsEmitted(senderRecipientInfo.rskRecipientRskAddressInfo.address, pegoutValueInSatoshis, PEGOUT_REJECTION_REASONS.LOW_AMOUNT);

      await assert2wpBalanceIsUnchanged(initial2wpBalances);

      // The rsk sender balance is the same as the initial balance minus the gas fee, because the pegout amount was refunded.
      const finalRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
      const gasFee = pegoutTransaction.gasUsed * pegoutTransaction.effectiveGasPrice;
      const expectedRskSenderBalanceInWeisBN = initialRskSenderBalanceInWeisBN.sub(new BN(`${gasFee}`));
      expect(finalRskSenderBalanceInWeisBN.eq(expectedRskSenderBalanceInWeisBN)).to.be.true;

      // The btc recipient address balance is the same as the initial balance, because the pegout didn't go though.
      const finalBtcRecipientBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalBtcRecipientBalanceInSatoshis).to.be.equal(initialBtcRecipientAddressBalanceInSatoshis);

    });

    it('should reject and refund a pegout when fee per kb is above value', async () => {

      // Arrange

      // Create a pegin for the sender to ensure there is enough funds to pegout and because this is the natural process
      const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
      const peginValueInSatoshis = btcToSatoshis(0.5);
      const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(peginValueInSatoshis));
      await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

      const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
      const initialBtcRecipientAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      const initialRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
      const pegoutValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS - 1;

      const initialFeePerKb = Number(await bridge.methods.getFeePerKb().call());
      // We just need to have a feePerKB that will cause the pegout to rejected due to FEE_ABOVE_VALUE reason.
      // This value is way bigger than what we need, but actual calculation is complex and and estimation so we cannot know for sure.
      // That's we we just use a big enough value. The MINIMUM_PEGOUT_AMOUNT_IN_RBTC is perfect for this in this case.
      const newFeePerKbInSatoshis = btcToSatoshis(MINIMUM_PEGOUT_AMOUNT_IN_RBTC);
      await setFeePerKb(rskTxHelper, newFeePerKbInSatoshis);

      // Act

      const pegoutTransaction = await sendTxToBridge(rskTxHelper, new BN(satoshisToWeis(pegoutValueInSatoshis)), senderRecipientInfo.rskRecipientRskAddressInfo.address);

      // Assert

      await assertExpectedReleaseRequestRejectedEventIsEmitted(senderRecipientInfo.rskRecipientRskAddressInfo.address, pegoutValueInSatoshis, PEGOUT_REJECTION_REASONS.FEE_ABOVE_VALUE);

      await assert2wpBalanceIsUnchanged(initial2wpBalances);

      // The rsk sender balance is the same as the initial balance minus the gas fee, because the pegout amount was refunded.
      const finalRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
      const gasFee = pegoutTransaction.gasUsed * pegoutTransaction.effectiveGasPrice;
      const expectedRskSenderBalanceInWeisBN = initialRskSenderBalanceInWeisBN.sub(new BN(`${gasFee}`));
      expect(finalRskSenderBalanceInWeisBN.eq(expectedRskSenderBalanceInWeisBN)).to.be.true;

      // The btc recipient address balance is the same as the initial balance, because the pegout didn't go though.
      const finalBtcRecipientBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, senderRecipientInfo.btcSenderAddressInfo.address);
      expect(finalBtcRecipientBalanceInSatoshis).to.be.equal(initialBtcRecipientAddressBalanceInSatoshis);

      // Setting fee per kb back to its original value
      await setFeePerKb(rskTxHelper, initialFeePerKb);

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

const assertSuccessfulPegoutEventsAreEmitted = async (pegoutsEvents, pegoutRequestReceivedTransactionHash, senderRecipientInfo, pegoutValueInSatoshis, bridgeStateAfterPegoutCreation) => {

  const pegoutWaitingForConfirmationWhenPegoutWasCreated = bridgeStateAfterPegoutCreation.pegoutsWaitingForConfirmations[0];
  const btcTransaction = bitcoinJsLib.Transaction.fromHex(pegoutWaitingForConfirmationWhenPegoutWasCreated.btcRawTx);
  const rskSenderAddress = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(senderRecipientInfo.rskRecipientRskAddressInfo.address));

  // release_request_received event
  const releaseRequestReceivedEvent = pegoutsEvents[0];
  expect(releaseRequestReceivedEvent.arguments.sender).to.be.equal(rskSenderAddress);
  expect(Number(releaseRequestReceivedEvent.arguments.amount)).to.be.equal(pegoutValueInSatoshis);
  expect(releaseRequestReceivedEvent.arguments.btcDestinationAddress).to.be.equal(senderRecipientInfo.btcSenderAddressInfo.address);

  // release_requested event
  const pegoutCreationRskTransactionHash = ensure0x(pegoutWaitingForConfirmationWhenPegoutWasCreated.rskTxHash.padStart(64, '0'));
  const releaseRequestedEvent = pegoutsEvents[1];
  expect(releaseRequestedEvent.arguments.rskTxHash).to.be.equal(pegoutCreationRskTransactionHash);
  expect(removePrefix0x(releaseRequestedEvent.arguments.btcTxHash)).to.be.equal(btcTransaction.getId());
  expect(Number(releaseRequestReceivedEvent.arguments.amount)).to.be.equal(pegoutValueInSatoshis);

  // batch_pegout_created event
  const batchPegoutCreatedEvent = pegoutsEvents[2];
  expect(removePrefix0x(batchPegoutCreatedEvent.arguments.btcTxHash)).to.be.equal(btcTransaction.getId());
  expect(batchPegoutCreatedEvent.arguments.releaseRskTxHashes.includes(removePrefix0x(pegoutRequestReceivedTransactionHash))).to.be.true;


  // pegout_confirmed event
  const pegoutConfirmedEvent = pegoutsEvents[3];
  expect(removePrefix0x(pegoutConfirmedEvent.arguments.btcTxHash)).to.be.equal(btcTransaction.getId());
  expect(pegoutConfirmedEvent.arguments.pegoutCreationRskBlockNumber).to.be.equal(pegoutWaitingForConfirmationWhenPegoutWasCreated.pegoutCreationBlockNumber);

  // add_signature events
  const addSignatureEvent1 = pegoutsEvents[4];
  const addSignatureEvent2 = pegoutsEvents[5];
  const addSignatureEvent3 = pegoutsEvents[6];

  expect(addSignatureEvent1.arguments.releaseRskTxHash).to.be.equal(releaseRequestedEvent.arguments.rskTxHash);
  expect(addSignatureEvent2.arguments.releaseRskTxHash).to.be.equal(releaseRequestedEvent.arguments.rskTxHash);
  expect(addSignatureEvent3.arguments.releaseRskTxHash).to.be.equal(releaseRequestedEvent.arguments.rskTxHash);

  // Final event, release_btc 
  const releaseBtcEvent = pegoutsEvents[7];
  expect(releaseBtcEvent.arguments.releaseRskTxHash).to.be.equal(releaseRequestedEvent.arguments.rskTxHash);

};

/**
 * Asserts the 2wp balances after a successful pegout, ensuring that the federation balance is decreased by the pegout value, the bridge rsk balance is increased by the pegout value and the bridge utxos balance is decreased by the pegout value.
 * @param {{federationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}} initial2wpBalances 
 * @param {number} pegoutValueInRbtc the value in RBTC of the pegout
 */
const assert2wpBalanceAfterSuccessfulPegout = async (initial2wpBalances, pegoutValueInSatoshis) => {

  const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);

  expect(final2wpBalances.federationAddressBalanceInSatoshis).to.be.equal(initial2wpBalances.federationAddressBalanceInSatoshis - pegoutValueInSatoshis);

  const expectedFinalBridgeBalancesInWeisBN = initial2wpBalances.bridgeBalanceInWeisBN.add(new BN(satoshisToWeis(pegoutValueInSatoshis)));
  expect(final2wpBalances.bridgeBalanceInWeisBN.eq(expectedFinalBridgeBalancesInWeisBN)).to.be.true;

  expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(initial2wpBalances.bridgeUtxosBalanceInSatoshis - pegoutValueInSatoshis);

};

const assertExpectedReleaseRequestRejectedEventIsEmitted = async (rskSenderAddress, amountInSatoshis, rejectionReason) => {
  const rskSenderAddressChecksummed = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(rskSenderAddress));
  const expectedEvent = createExpectedReleaseRequestRejectedEvent(rskSenderAddressChecksummed, amountInSatoshis, rejectionReason);
  const releaseRequestRejectedEvent = await findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_REQUEST_REJECTED.name);
  expect(releaseRequestRejectedEvent).to.be.deep.equal(expectedEvent);
};

module.exports = {
  execute,
};
