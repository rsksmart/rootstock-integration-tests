const expect = require('chai').expect;
const BN = require('bn.js');
const { createPeginV1TxData } = require('pegin-address-verificator');
const { getBridge } = require('../bridge-provider');
const { getBtcClient } = require('../btc-client-provider');
const { getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const {
    satoshisToBtc,
    btcToSatoshis,
    satoshisToWeis,
    ethToWeis,
} = require('@rsksmart/btc-eth-unit-converter');
const {
    triggerRelease,
    setFeePerKb,
    sendTransaction,
    getNewFundedRskAddress,
    getRskHost,
    mineAndSync,
    triggerReleaseUntilPipelineDrained,
    sendFromCow,
} = require('../rsk-utils');
const {
    assert2wpBalancesAfterSuccessfulPegin,
    assertUtxosAreRegisteredInActiveFederationUtxos,
    assertBtcTxIsMinedAtHeight,
    assertSpentUtxosNotAvailableAnyMore,
} = require('../assertions/2wp');
const {
    assertExpectedPeginBtcEventIsEmitted,
    assertExpectedRejectedPeginEventIsEmitted,
    assertNoPeginEventsAreEmitted,
    assertReleaseRequestedEventIsEmittedForRefund,
    assertReleaseRequestReceivedEvent,
    assertReleaseRequestedEvent,
    assertBatchPegoutCreatedEvent,
    assertPegoutConfirmedEvent,
    assertAddSignatureEvents,
    assertReleaseBtcEvent,
    assertSuccessfulPegoutEventsAreEmitted,
    assertExpectedReleaseRequestRejectedEventIsEmitted,
    assertPegoutTransactionCreatedEventIsEmitted,
    assertUtxosRegisteredEventIsEmitted,
} = require('../assertions/events');
const {
    getPegoutEventsInBlockRange,
    createExpectedReleaseRequestRejectedEvent,
    getReleaseRequestRejectedEventFromContractCallTxReceipt,
    findEventInTx,
} = require('../events-utils');
const {
    PEGIN_V1_RSKT_PREFIX_HEX,
    PEGIN_OUTPUT_INDEX_TO_FEDERATION,
} = require('../constants/pegin-constants');
const {
    MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS,
    MAX_STANDARD_TX_SIZE_ALLOWED,
} = require('../constants/pegout-constants');
const {
    PEGOUT_EVENTS,
    PEGIN_REJECTION_REASONS,
    PEGOUT_REJECTION_REASONS,
} = require('../constants/events-constants');
const { BRIDGE_ADDRESS } = require('../constants/bridge-constants');

const {
    sendPeginToActiveFederation,
    ensureBtcTxIsRegistered,
    createSenderRecipientInfo,
    get2wpBalances,
    assertRefundUtxosSameAsPeginUtxos,
    sendTxToBridge,
    fundRskAccountThroughAPegin,
    createExpectedUtxo,
} = require('../2wp-utils');
const {
    getBtcAddressBalanceInSatoshis,
    base58AddressToHash160,
    getBtcTxBlockHeight,
} = require('../btc-utils');
const { ensure0x, removePrefix0x } = require('../utils');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const bitcoinJsLib = require('bitcoinjs-lib');
const { deployCallReleaseBtcContract } = require('../contractDeployer');

// A P2PKH output: 8 bytes of value, 1 byte of script length and a 25 byte script. Outputs carry no
// witness, so each one adds its full size to the tx virtual size.
const P2PKH_OUTPUT_SIZE_IN_BYTES = 34;
// The same gas price `sendTxToBridge` uses
const PEGOUT_REQUEST_GAS_PRICE = 2;
// A pegout request costs 21000 of intrinsic gas plus the Bridge's fixed 23000 for `releaseBtc`
const PEGOUT_REQUEST_GAS_LIMIT = 60000;

let btcTxHelper;
let rskTxHelpers;
let rskTxHelper;
let bridge;
let federationAddress;
let minimumPeginValueInSatoshis;
let btcFeeInSatoshis;

const execute = (description, fullExecution = false) => {
    describe(description, () => {
        before(async () => {
            btcTxHelper = getBtcClient();
            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            bridge = await getBridge(rskTxHelper.getClient());

            federationAddress = await bridge.methods.getFederationAddress().call();
            minimumPeginValueInSatoshis = Number(
                await bridge.methods.getMinimumLockTxValue().call()
            );
            btcFeeInSatoshis = Number(btcToSatoshis(await btcTxHelper.getFee()));
        });

        after(async () => {
            // Ensure there's no pegout txs left to be processed
            await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);
        });

        describe('Pegin tests', () => {
            it('should do a basic legacy pegin with the exact minimum value', async () => {
                // Arrange
                const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                const senderRecipientInfo = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper
                );
                const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo.address
                );
                const peginValueInSatoshis = minimumPeginValueInSatoshis;

                // Act

                const btcBlockNumberBeforeSendingPegin = await btcTxHelper.getLatestBlockNumber();
                const btcPeginTxHash = await sendPeginToActiveFederation(
                    rskTxHelper,
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo,
                    satoshisToBtc(peginValueInSatoshis)
                );

                // Assert

                await ensureBtcTxIsRegistered(rskTxHelper, btcPeginTxHash);

                await assertExpectedPeginBtcEventIsEmitted(
                    rskTxHelper,
                    btcPeginTxHash,
                    senderRecipientInfo.rskRecipientRskAddressInfo.address,
                    peginValueInSatoshis
                );

                await assertPeginUtxoIsRegisteredInBridge(
                    btcPeginTxHash,
                    peginValueInSatoshis,
                    btcBlockNumberBeforeSendingPegin
                );

                await assert2wpBalancesAfterSuccessfulPegin(
                    rskTxHelper,
                    btcTxHelper,
                    initial2wpBalances,
                    peginValueInSatoshis
                );

                // The btc sender address balance is decreased by the pegin value and the btc fee
                const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo.address
                );
                expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                    initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis
                );

                // The recipient rsk address balance is increased by the pegin value
                const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );
                const expectedRskRecipientBalancesInWeisBN = new BN(
                    satoshisToWeis(peginValueInSatoshis)
                );
                expect(finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)).to
                    .be.true;
            });

            it('should do a basic pegin v1 with the exact minimum value', async () => {
                // Arrange
                const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                const senderRecipientInfo = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper
                );
                const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo.address
                );
                const peginValueInSatoshis = minimumPeginValueInSatoshis;
                const peginV1RskRecipientAddress =
                    await rskTxHelper.newAccountWithSeed('successfulPeginV1');
                const peginV1RskRecipientAddressInitialBalanceInWeisBN =
                    await rskTxHelper.getBalance(peginV1RskRecipientAddress);

                // Act

                const peginV1Data = [
                    Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex'),
                ];

                const btcBlockNumberBeforeSendingPegin = await btcTxHelper.getLatestBlockNumber();
                const btcPeginTxHash = await sendPeginToActiveFederation(
                    rskTxHelper,
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo,
                    Number(satoshisToBtc(peginValueInSatoshis)),
                    peginV1Data
                );

                // Assert

                await ensureBtcTxIsRegistered(rskTxHelper, btcPeginTxHash);

                const expectedPeginProtocolVersion = '1';
                await assertExpectedPeginBtcEventIsEmitted(
                    rskTxHelper,
                    btcPeginTxHash,
                    peginV1RskRecipientAddress,
                    peginValueInSatoshis,
                    expectedPeginProtocolVersion
                );

                await assertPeginUtxoIsRegisteredInBridge(
                    btcPeginTxHash,
                    peginValueInSatoshis,
                    btcBlockNumberBeforeSendingPegin
                );

                await assert2wpBalancesAfterSuccessfulPegin(
                    rskTxHelper,
                    btcTxHelper,
                    initial2wpBalances,
                    peginValueInSatoshis
                );

                // The sender address balance is decreased by the pegin value and the btc fee
                const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo.address
                );
                expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                    initialSenderAddressBalanceInSatoshis - peginValueInSatoshis - btcFeeInSatoshis
                );

                // The sender derived rsk address rsk address balance is unchanged
                const finalSenderDerivedRskAddressBalanceInWeisBN = await rskTxHelper.getBalance(
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );
                expect(finalSenderDerivedRskAddressBalanceInWeisBN.eq(new BN('0'))).to.be.true;

                // The pegin v1 rsk recipient address has the funds
                const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                    peginV1RskRecipientAddress
                );
                const expectedFinalRskRecipientBalanceInWeisBN = new BN(
                    satoshisToWeis(peginValueInSatoshis)
                ).add(peginV1RskRecipientAddressInitialBalanceInWeisBN);
                expect(
                    finalRskRecipientBalanceInWeisBN.eq(expectedFinalRskRecipientBalanceInWeisBN)
                ).to.be.true;
            });

            if (fullExecution) {
                it('should do a basic legacy pegin with the value exactly above minimum', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper
                    );
                    const initialSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    // Value exactly above minimum
                    const peginValueInSatoshis = minimumPeginValueInSatoshis + 1;

                    // Act
                    const btcBlockNumberBeforeSendingPegin =
                        await btcTxHelper.getLatestBlockNumber();
                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        satoshisToBtc(peginValueInSatoshis)
                    );

                    // Assert

                    await ensureBtcTxIsRegistered(rskTxHelper, btcPeginTxHash);

                    await assertExpectedPeginBtcEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        senderRecipientInfo.rskRecipientRskAddressInfo.address,
                        peginValueInSatoshis
                    );

                    await assertPeginUtxoIsRegisteredInBridge(
                        btcPeginTxHash,
                        peginValueInSatoshis,
                        btcBlockNumberBeforeSendingPegin
                    );

                    await assert2wpBalancesAfterSuccessfulPegin(
                        rskTxHelper,
                        btcTxHelper,
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // The sender address balance is decreased by the pegin value and the btc fee
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        initialSenderAddressBalanceInSatoshis -
                            peginValueInSatoshis -
                            btcFeeInSatoshis
                    );

                    // The recipient rsk address balance is increased by the pegin value
                    const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                        senderRecipientInfo.rskRecipientRskAddressInfo.address
                    );
                    const expectedRskRecipientBalancesInWeisBN = new BN(
                        satoshisToWeis(peginValueInSatoshis)
                    );
                    expect(
                        finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)
                    ).to.be.true;
                });

                it('should reject and not refund a legacy pegin with the value exactly below minimum', async () => {
                    // Arrange
                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const initialFederationAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper
                    );
                    const initialSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    // The minimum pegin value minus 1 satoshis
                    const peginValueInSatoshis = minimumPeginValueInSatoshis - 1;

                    // Act

                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        Number(satoshisToBtc(peginValueInSatoshis))
                    );
                    // Funds of a pegin with value below minimum are lost. But calling triggerRelease here to ensure that nothing will be refunded.
                    await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);

                    // Assert

                    // The btc pegin tx is not marked as processed by the bridge
                    await assertPeginTxHashNotProcessed(btcPeginTxHash);

                    await assert2wpBalancesPeginRejectedNoRefund(
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // The federation balance is increased by the pegin value
                    const finalFederationAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
                    expect(finalFederationAddressBalanceInSatoshis).to.be.equal(
                        initialFederationAddressBalanceInSatoshis + peginValueInSatoshis
                    );

                    // The sender address balance is decreased by the pegin value and the btc fee
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        initialSenderAddressBalanceInSatoshis -
                            peginValueInSatoshis -
                            btcFeeInSatoshis
                    );

                    // The recipient rsk address balance is zero
                    const finalRskRecipientBalance = Number(
                        await rskTxHelper.getBalance(
                            senderRecipientInfo.rskRecipientRskAddressInfo.address
                        )
                    );
                    expect(finalRskRecipientBalance).to.be.equal(0);
                });

                it('should reject and not refund a basic pegin v1 with value exactly below minimum', async () => {
                    // Arrange
                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper
                    );
                    const initialSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    // The minimum pegin value minus 1 satoshis
                    const peginValueInSatoshis = minimumPeginValueInSatoshis - 1;

                    const peginV1RskRecipientAddress =
                        await rskTxHelper.newAccountWithSeed('rejectedPeginV1');
                    const peginV1RskRecipientAddressInitialBalanceInWeisBN =
                        await rskTxHelper.getBalance(peginV1RskRecipientAddress);

                    // Act

                    const peginV1Data = [
                        Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex'),
                    ];

                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        satoshisToBtc(peginValueInSatoshis),
                        peginV1Data
                    );
                    // Funds of a pegin with value below minimum are lost. But calling triggerRelease here to ensure that nothing will be refunded.
                    await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);

                    // Assert

                    // The btc pegin tx is not marked as processed by the bridge
                    await assertPeginTxHashNotProcessed(btcPeginTxHash);

                    await assert2wpBalancesPeginRejectedNoRefund(
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // The sender address balance is decreased by the pegin value and the btc fee
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        initialSenderAddressBalanceInSatoshis -
                            peginValueInSatoshis -
                            btcFeeInSatoshis
                    );

                    // The sender derived rsk address rsk address balance is unchanged
                    const finalSenderDerivedRskAddressBalance = Number(
                        await rskTxHelper.getBalance(
                            senderRecipientInfo.rskRecipientRskAddressInfo.address
                        )
                    );
                    expect(finalSenderDerivedRskAddressBalance).to.be.equal(0);

                    const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                        peginV1RskRecipientAddress
                    );
                    expect(
                        finalRskRecipientBalanceInWeisBN.eq(
                            peginV1RskRecipientAddressInitialBalanceInWeisBN
                        )
                    ).to.be.true;
                });

                it('should reject and refund a legacy pegin from a multisig account with the value exactly minimum', async () => {
                    // Arrange
                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const multisigSenderAddressInfo = await btcTxHelper.generateMultisigAddress(
                        3,
                        2,
                        'legacy'
                    );
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    await btcTxHelper.fundAddress(
                        multisigSenderAddressInfo.address,
                        Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis))
                    );

                    // Act

                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        multisigSenderAddressInfo,
                        Number(satoshisToBtc(peginValueInSatoshis))
                    );
                    // The Bridge creates the refund pegout in the same rsk tx that registers the pegin
                    const bridgeState = await getBridgeState(getRskHost(rskTxHelper));
                    const pegoutsWFC = bridgeState.pegoutsWaitingForConfirmations;

                    // Assert

                    await assertBtcPeginTxHashProcessed(btcPeginTxHash);

                    // The rejected_pegin event is emitted with the expected values
                    const btcTxHashProcessedHeight = Number(
                        await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call()
                    );
                    await assertExpectedRejectedPeginEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        btcTxHashProcessedHeight,
                        PEGIN_REJECTION_REASONS.LEGACY_PEGIN_MULTISIG_SENDER
                    );
                    await assertReleaseRequestedEventIsEmittedForRefund(
                        rskTxHelper,
                        btcPeginTxHash,
                        btcTxHashProcessedHeight,
                        peginValueInSatoshis,
                        pegoutsWFC
                    );

                    // Expecting the multisig btc sender balance to be zero after the pegin.
                    const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        multisigSenderAddressInfo.address
                    );
                    expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

                    // We are expecting a refund pegout to go through. So, let's push it.
                    await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);

                    await assert2wpBalanceIsUnchanged(initial2wpBalances);

                    // Finally, the multisig btc sender address should have received the funds back minus certain fee.
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            multisigSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis)
                        .to.be.above(peginValueInSatoshis - btcFeeInSatoshis)
                        .and.below(peginValueInSatoshis);
                });

                it('should reject and not refund a legacy pegin from a multisig account with the value exactly below minimum', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const multisigSenderAddressInfo = await btcTxHelper.generateMultisigAddress(
                        3,
                        2,
                        'legacy'
                    );
                    const peginValueInSatoshis = minimumPeginValueInSatoshis - 1;
                    await btcTxHelper.fundAddress(
                        multisigSenderAddressInfo.address,
                        Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis))
                    );

                    // Act

                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        multisigSenderAddressInfo,
                        Number(satoshisToBtc(peginValueInSatoshis))
                    );

                    // Assert

                    await assertPeginTxHashNotProcessed(btcPeginTxHash);

                    // Expecting the multisig btc sender balance to be zero after the pegin.
                    const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        multisigSenderAddressInfo.address
                    );
                    expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

                    // To ensure no refund is made, let's try to push any possible refund pegout.
                    await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);

                    await assert2wpBalancesPeginRejectedNoRefund(
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // Finally, the multisig btc sender address should not have received the funds back.
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            multisigSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        senderAddressBalanceAfterPegin
                    );
                });

                it('should do a pegin v1 from multisig with the exact minimum value', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const multisigSenderAddressInfo = await btcTxHelper.generateMultisigAddress(
                        3,
                        2,
                        'legacy'
                    );
                    await btcTxHelper.fundAddress(
                        multisigSenderAddressInfo.address,
                        Number(satoshisToBtc(minimumPeginValueInSatoshis + btcFeeInSatoshis))
                    );
                    const initialSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            multisigSenderAddressInfo.address
                        );
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed(
                        'successfulPeginV1FromMultisig'
                    );
                    const peginV1RskRecipientAddressInitialBalanceInWeisBN =
                        await rskTxHelper.getBalance(peginV1RskRecipientAddress);

                    // Act

                    const peginV1Data = [
                        Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex'),
                    ];

                    const btcBlockNumberBeforeSendingPegin =
                        await btcTxHelper.getLatestBlockNumber();
                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        multisigSenderAddressInfo,
                        Number(satoshisToBtc(peginValueInSatoshis)),
                        peginV1Data
                    );

                    // Assert

                    await ensureBtcTxIsRegistered(rskTxHelper, btcPeginTxHash);

                    const expectedPeginProtocolVersion = '1';
                    await assertExpectedPeginBtcEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        peginV1RskRecipientAddress,
                        peginValueInSatoshis,
                        expectedPeginProtocolVersion
                    );

                    await assertPeginUtxoIsRegisteredInBridge(
                        btcPeginTxHash,
                        peginValueInSatoshis,
                        btcBlockNumberBeforeSendingPegin
                    );

                    await assert2wpBalancesAfterSuccessfulPegin(
                        rskTxHelper,
                        btcTxHelper,
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // The sender address balance is decreased by the pegin value and the btc fee
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            multisigSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        initialSenderAddressBalanceInSatoshis -
                            peginValueInSatoshis -
                            btcFeeInSatoshis
                    );

                    // The pegin v1 rsk recipient address has the funds
                    const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                        peginV1RskRecipientAddress
                    );
                    const expectedFinalRskRecipientBalanceInWeisBN = new BN(
                        satoshisToWeis(peginValueInSatoshis)
                    );
                    expect(
                        finalRskRecipientBalanceInWeisBN.eq(
                            expectedFinalRskRecipientBalanceInWeisBN.add(
                                peginV1RskRecipientAddressInitialBalanceInWeisBN
                            )
                        )
                    ).to.be.true;
                });

                it('should do a pegin v1 from bech32 sender with the exact minimum value', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const bech32SenderAddressInfo = await btcTxHelper.generateBtcAddress('bech32');
                    await btcTxHelper.fundAddress(
                        bech32SenderAddressInfo.address,
                        Number(satoshisToBtc(minimumPeginValueInSatoshis + btcFeeInSatoshis))
                    );
                    const initialSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            bech32SenderAddressInfo.address
                        );
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed(
                        'successfulPeginV1FromBech32'
                    );
                    const peginV1RskRecipientAddressInitialBalanceInWeisBN =
                        await rskTxHelper.getBalance(peginV1RskRecipientAddress);

                    // Act

                    const peginV1Data = [
                        Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex'),
                    ];

                    const btcBlockNumberBeforeSendingPegin =
                        await btcTxHelper.getLatestBlockNumber();
                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        bech32SenderAddressInfo,
                        Number(satoshisToBtc(peginValueInSatoshis)),
                        peginV1Data
                    );

                    // Assert

                    await ensureBtcTxIsRegistered(rskTxHelper, btcPeginTxHash);

                    const expectedPeginProtocolVersion = '1';
                    await assertExpectedPeginBtcEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        peginV1RskRecipientAddress,
                        peginValueInSatoshis,
                        expectedPeginProtocolVersion
                    );

                    await assertPeginUtxoIsRegisteredInBridge(
                        btcPeginTxHash,
                        peginValueInSatoshis,
                        btcBlockNumberBeforeSendingPegin
                    );

                    await assert2wpBalancesAfterSuccessfulPegin(
                        rskTxHelper,
                        btcTxHelper,
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // The sender address balance is decreased by the pegin value and the btc fee
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            bech32SenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        initialSenderAddressBalanceInSatoshis -
                            peginValueInSatoshis -
                            btcFeeInSatoshis
                    );

                    // The pegin v1 rsk recipient address has the funds
                    const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                        peginV1RskRecipientAddress
                    );
                    const expectedFinalRskRecipientBalanceInWeisBN = new BN(
                        satoshisToWeis(peginValueInSatoshis)
                    );
                    expect(
                        finalRskRecipientBalanceInWeisBN.eq(
                            expectedFinalRskRecipientBalanceInWeisBN.add(
                                peginV1RskRecipientAddressInitialBalanceInWeisBN
                            )
                        )
                    ).to.be.true;
                });

                it('should do a basic pegin v1 with btc refund address and the exact minimum value', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper
                    );
                    const initialSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed(
                        'successfulPeginV1WithBtcRefundAddress'
                    );
                    const peginV1RskRecipientAddressInitialBalanceInWeisBN =
                        await rskTxHelper.getBalance(peginV1RskRecipientAddress);

                    // Act

                    const peginV1Data = [
                        Buffer.from(
                            createPeginV1TxData(
                                peginV1RskRecipientAddress,
                                senderRecipientInfo.btcSenderAddressInfo.address
                            ),
                            'hex'
                        ),
                    ];

                    const btcBlockNumberBeforeSendingPegin =
                        await btcTxHelper.getLatestBlockNumber();
                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        Number(satoshisToBtc(peginValueInSatoshis)),
                        peginV1Data
                    );

                    // Assert

                    await ensureBtcTxIsRegistered(rskTxHelper, btcPeginTxHash);

                    const expectedPeginProtocolVersion = '1';
                    await assertExpectedPeginBtcEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        peginV1RskRecipientAddress,
                        peginValueInSatoshis,
                        expectedPeginProtocolVersion
                    );

                    await assertPeginUtxoIsRegisteredInBridge(
                        btcPeginTxHash,
                        peginValueInSatoshis,
                        btcBlockNumberBeforeSendingPegin
                    );

                    await assert2wpBalancesAfterSuccessfulPegin(
                        rskTxHelper,
                        btcTxHelper,
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // The sender address balance is decreased by the pegin value and the btc fee
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        initialSenderAddressBalanceInSatoshis -
                            peginValueInSatoshis -
                            btcFeeInSatoshis
                    );

                    // The sender derived rsk address rsk address balance is unchanged
                    const finalSenderDerivedRskAddressBalanceInWeisBN =
                        await rskTxHelper.getBalance(
                            senderRecipientInfo.rskRecipientRskAddressInfo.address
                        );
                    expect(finalSenderDerivedRskAddressBalanceInWeisBN.eq(new BN('0'))).to.be.true;

                    // The pegin v1 rsk recipient address has the funds
                    const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                        peginV1RskRecipientAddress
                    );
                    const expectedFinalRskRecipientBalanceInWeisBN = new BN(
                        satoshisToWeis(peginValueInSatoshis)
                    );
                    expect(
                        finalRskRecipientBalanceInWeisBN.eq(
                            expectedFinalRskRecipientBalanceInWeisBN.add(
                                peginV1RskRecipientAddressInitialBalanceInWeisBN
                            )
                        )
                    ).to.be.true;
                });

                it('should not inform a legacy pegin from a bech32 sender with the value exactly minimum', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const bech32SenderAddressInfo = await btcTxHelper.generateBtcAddress('bech32');
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    await btcTxHelper.fundAddress(
                        bech32SenderAddressInfo.address,
                        Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis))
                    );

                    // Act

                    const blockNumberBeforePegin = await rskTxHelper.getBlockNumber();

                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        bech32SenderAddressInfo,
                        Number(satoshisToBtc(peginValueInSatoshis))
                    );

                    // Assert

                    // To ensure no refund is made, let's try to push any possible refund pegout.
                    await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);

                    await assertPeginTxHashNotProcessed(btcPeginTxHash);
                    // Since we are not informing the pegin, no events are emitted in this scenario
                    await assertNoPeginEventsAreEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        blockNumberBeforePegin
                    );

                    // Expecting the multisig btc sender balance to be zero after the pegin.
                    const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        bech32SenderAddressInfo.address
                    );
                    expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

                    // To ensure no refund is made, let's try to push any possible refund pegout.
                    await triggerRelease(rskTxHelpers, btcTxHelper);

                    await assert2wpBalancesPeginRejectedNoRefund(
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // Finally, the multisig btc sender address should not have received the funds back.
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            bech32SenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        senderAddressBalanceAfterPegin
                    );
                });

                it('should reject and refund pegin with multiple OP_RETURN outputs for RSK with value exactly minimum', async () => {
                    // Arrange
                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper,
                        'p2sh-segwit',
                        Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis))
                    );
                    const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed(
                        'rejectedPeginWithMultipleOpReturnOutputs'
                    );

                    const data = [];
                    data.push(
                        Buffer.from(
                            createPeginV1TxData(
                                senderRecipientInfo.rskRecipientRskAddressInfo.address
                            ),
                            'hex'
                        ),
                        Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex')
                    );

                    // Act

                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        satoshisToBtc(peginValueInSatoshis),
                        data
                    );
                    // The Bridge creates the refund pegout in the same rsk tx that registers the pegin
                    const bridgeState = await getBridgeState(getRskHost(rskTxHelper));
                    const pegoutsWFC = bridgeState.pegoutsWaitingForConfirmations;

                    // Assert

                    // Expecting the btc sender balance to be zero right after the pegin.
                    const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo.address
                    );
                    expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

                    // We are expecting a refund pegout to go through. So, let's push it.
                    await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);

                    await assertBtcPeginTxHashProcessed(btcPeginTxHash);

                    // The rejected_pegin and released_requested events are emitted with the expected values
                    const btcTxHashProcessedHeight = Number(
                        await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call()
                    );
                    await assertExpectedRejectedPeginEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        btcTxHashProcessedHeight,
                        PEGIN_REJECTION_REASONS.PEGIN_V1_INVALID_PAYLOAD_REASON
                    );
                    await assertReleaseRequestedEventIsEmittedForRefund(
                        rskTxHelper,
                        btcPeginTxHash,
                        btcTxHashProcessedHeight,
                        peginValueInSatoshis,
                        pegoutsWFC
                    );

                    await assert2wpBalanceIsUnchanged(initial2wpBalances);

                    // Finally, the btc sender address should have received the funds back minus certain fee.
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis)
                        .to.be.above(peginValueInSatoshis - btcFeeInSatoshis)
                        .and.below(peginValueInSatoshis);

                    // Check the same UTXOs used for the peg-in tx were used for the reject tx
                    await assertRefundUtxosSameAsPeginUtxos(
                        rskTxHelper,
                        btcTxHelper,
                        btcPeginTxHash,
                        senderRecipientInfo.btcSenderAddressInfo.address
                    );
                });

                it('should do a pegin v1 with multiple OP_RETURN outputs but only one for RSK and the exact minimum value', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper
                    );
                    const initialSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed(
                        'successfulPeginV1Multiple_OP_RETURN'
                    );
                    const peginV1RskRecipientAddressInitialBalanceInWeisBN =
                        await rskTxHelper.getBalance(peginV1RskRecipientAddress);

                    // Act

                    const peginV1Data = [];
                    peginV1Data.push(
                        Buffer.from('some random data', 'hex'),
                        Buffer.from(createPeginV1TxData(peginV1RskRecipientAddress), 'hex'),
                        Buffer.from('some more random data', 'hex')
                    );

                    const btcBlockNumberBeforeSendingPegin =
                        await btcTxHelper.getLatestBlockNumber();
                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        Number(satoshisToBtc(peginValueInSatoshis)),
                        peginV1Data
                    );

                    // Assert

                    await ensureBtcTxIsRegistered(rskTxHelper, btcPeginTxHash);

                    const expectedPeginProtocolVersion = '1';
                    await assertExpectedPeginBtcEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        peginV1RskRecipientAddress,
                        peginValueInSatoshis,
                        expectedPeginProtocolVersion
                    );

                    await assertPeginUtxoIsRegisteredInBridge(
                        btcPeginTxHash,
                        peginValueInSatoshis,
                        btcBlockNumberBeforeSendingPegin
                    );

                    await assert2wpBalancesAfterSuccessfulPegin(
                        rskTxHelper,
                        btcTxHelper,
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // The sender address balance is decreased by the pegin value and the btc fee
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        initialSenderAddressBalanceInSatoshis -
                            peginValueInSatoshis -
                            btcFeeInSatoshis
                    );

                    // The sender derived rsk address rsk address balance is unchanged
                    const finalSenderDerivedRskAddressBalanceInWeisBN =
                        await rskTxHelper.getBalance(
                            senderRecipientInfo.rskRecipientRskAddressInfo.address
                        );
                    expect(finalSenderDerivedRskAddressBalanceInWeisBN.eq(new BN('0'))).to.be.true;

                    // The pegin v1 rsk recipient address has the funds
                    const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                        peginV1RskRecipientAddress
                    );
                    const expectedFinalRskRecipientBalanceInWeisBN = new BN(
                        satoshisToWeis(peginValueInSatoshis)
                    );
                    expect(
                        finalRskRecipientBalanceInWeisBN.eq(
                            expectedFinalRskRecipientBalanceInWeisBN.add(
                                peginV1RskRecipientAddressInitialBalanceInWeisBN
                            )
                        )
                    ).to.be.true;
                });

                it('should reject and refund pegin with OP_RETURN output to RSK with invalid payload with value exactly minimum', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper,
                        'p2sh-segwit',
                        Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis))
                    );

                    const peginV1InvalidPayload = `${PEGIN_V1_RSKT_PREFIX_HEX}randomdata`;
                    const peginV1Data = [Buffer.from(peginV1InvalidPayload, 'hex')];

                    // Act

                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        satoshisToBtc(peginValueInSatoshis),
                        peginV1Data
                    );
                    // The Bridge creates the refund pegout in the same rsk tx that registers the pegin
                    const bridgeState = await getBridgeState(getRskHost(rskTxHelper));
                    const pegoutsWFC = bridgeState.pegoutsWaitingForConfirmations;

                    // Assert

                    // Expecting the btc sender balance to be zero right after the pegin.
                    const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo.address
                    );
                    expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

                    // We are expecting a refund pegout to go through. So, let's push it.
                    await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);

                    await assertBtcPeginTxHashProcessed(btcPeginTxHash);

                    // The rejected_pegin and released_requested events are emitted with the expected values
                    const btcTxHashProcessedHeight = Number(
                        await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call()
                    );
                    await assertExpectedRejectedPeginEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        btcTxHashProcessedHeight,
                        PEGIN_REJECTION_REASONS.PEGIN_V1_INVALID_PAYLOAD_REASON
                    );
                    await assertReleaseRequestedEventIsEmittedForRefund(
                        rskTxHelper,
                        btcPeginTxHash,
                        btcTxHashProcessedHeight,
                        peginValueInSatoshis,
                        pegoutsWFC
                    );

                    await assert2wpBalanceIsUnchanged(initial2wpBalances);

                    // Finally, the btc sender address should have received the funds back minus certain fee.
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis)
                        .to.be.above(peginValueInSatoshis - btcFeeInSatoshis)
                        .and.below(peginValueInSatoshis);

                    // Check the same UTXOs used for the peg-in tx were used for the reject tx
                    await assertRefundUtxosSameAsPeginUtxos(
                        rskTxHelper,
                        btcTxHelper,
                        btcPeginTxHash,
                        senderRecipientInfo.btcSenderAddressInfo.address
                    );
                });

                it('should reject and refund pegin with invalid pegin v1 version with value exactly minimum', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper,
                        'p2sh-segwit',
                        Number(satoshisToBtc(peginValueInSatoshis + btcFeeInSatoshis))
                    );
                    const peginV1RskRecipientAddress = await rskTxHelper.newAccountWithSeed(
                        'successfulPeginV1InvalidVersion'
                    );

                    const invalidPeginV1Version = '999';
                    const peginV1InvalidPayload = `${PEGIN_V1_RSKT_PREFIX_HEX}${invalidPeginV1Version}${removePrefix0x(peginV1RskRecipientAddress)}`;
                    const peginV1Data = [Buffer.from(peginV1InvalidPayload, 'hex')];

                    // Act

                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        satoshisToBtc(peginValueInSatoshis),
                        peginV1Data
                    );
                    // The Bridge creates the refund pegout in the same rsk tx that registers the pegin
                    const bridgeState = await getBridgeState(getRskHost(rskTxHelper));
                    const pegoutsWFC = bridgeState.pegoutsWaitingForConfirmations;

                    // Assert

                    // Expecting the btc sender balance to be zero right after the pegin.
                    const senderAddressBalanceAfterPegin = await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo.address
                    );
                    expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

                    // We are expecting a refund pegout to go through. So, let's push it.
                    await triggerRelease(rskTxHelpers, btcTxHelper, {}, false);

                    await assertBtcPeginTxHashProcessed(btcPeginTxHash);

                    // The rejected_pegin and released_requested events are emitted with the expected values
                    const btcTxHashProcessedHeight = Number(
                        await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call()
                    );
                    await assertExpectedRejectedPeginEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        btcTxHashProcessedHeight,
                        PEGIN_REJECTION_REASONS.PEGIN_V1_INVALID_PAYLOAD_REASON
                    );
                    await assertReleaseRequestedEventIsEmittedForRefund(
                        rskTxHelper,
                        btcPeginTxHash,
                        btcTxHashProcessedHeight,
                        peginValueInSatoshis,
                        pegoutsWFC
                    );

                    await assert2wpBalanceIsUnchanged(initial2wpBalances);

                    // Finally, the btc sender address should have received the funds back minus certain fee.
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis)
                        .to.be.above(peginValueInSatoshis - btcFeeInSatoshis)
                        .and.below(peginValueInSatoshis);

                    // Check the same UTXOs used for the peg-in tx were used for the reject tx
                    await assertRefundUtxosSameAsPeginUtxos(
                        rskTxHelper,
                        btcTxHelper,
                        btcPeginTxHash,
                        senderRecipientInfo.btcSenderAddressInfo.address
                    );
                });

                it('should do a basic legacy pegin using p2sh-segwit sender with the exact minimum value', async () => {
                    // Arrange

                    const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper,
                        'p2sh-segwit'
                    );
                    const initialSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    const peginValueInSatoshis = minimumPeginValueInSatoshis;

                    // Act

                    const btcBlockNumberBeforeSendingPegin =
                        await btcTxHelper.getLatestBlockNumber();
                    const btcPeginTxHash = await sendPeginToActiveFederation(
                        rskTxHelper,
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo,
                        satoshisToBtc(peginValueInSatoshis)
                    );

                    // Assert

                    await ensureBtcTxIsRegistered(rskTxHelper, btcPeginTxHash);

                    await assertExpectedPeginBtcEventIsEmitted(
                        rskTxHelper,
                        btcPeginTxHash,
                        senderRecipientInfo.rskRecipientRskAddressInfo.address,
                        peginValueInSatoshis
                    );

                    await assertPeginUtxoIsRegisteredInBridge(
                        btcPeginTxHash,
                        peginValueInSatoshis,
                        btcBlockNumberBeforeSendingPegin
                    );

                    await assert2wpBalancesAfterSuccessfulPegin(
                        rskTxHelper,
                        btcTxHelper,
                        initial2wpBalances,
                        peginValueInSatoshis
                    );

                    // The btc sender address balance is decreased by the pegin value and the btc fee
                    const finalSenderAddressBalanceInSatoshis =
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            senderRecipientInfo.btcSenderAddressInfo.address
                        );
                    expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                        initialSenderAddressBalanceInSatoshis -
                            peginValueInSatoshis -
                            btcFeeInSatoshis
                    );

                    // The recipient rsk address balance is increased by the pegin value
                    const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(
                        senderRecipientInfo.rskRecipientRskAddressInfo.address
                    );
                    const expectedRskRecipientBalancesInWeisBN = new BN(
                        satoshisToWeis(peginValueInSatoshis)
                    );
                    expect(
                        finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)
                    ).to.be.true;
                });
            } // end if (fullExecution) — pegin full-only tests
        });

        it('should do a pegout with value exactly minimum', async () => {
            // Arrange

            // Create a pegin for the sender to ensure there is enough funds to pegout and because this is the natural process
            const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper);
            await fundRskAccountThroughAPegin(
                rskTxHelper,
                btcTxHelper,
                senderRecipientInfo.btcSenderAddressInfo
            );

            const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
            const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                btcTxHelper,
                senderRecipientInfo.btcSenderAddressInfo.address
            );
            const pegoutValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS;

            const bridgeStateBeforePegoutCreation = await getBridgeState(getRskHost(rskTxHelper));

            // Act
            const pegoutTransaction = await sendTxToBridge(
                rskTxHelper,
                new BN(satoshisToWeis(pegoutValueInSatoshis)),
                senderRecipientInfo.rskRecipientRskAddressInfo.address
            );

            // Assert
            let bridgeStateAfterPegoutCreation;

            // Callback to get the bridge state after the pegout is created
            const pegoutCreatedCallback = async () => {
                bridgeStateAfterPegoutCreation = await getBridgeState(getRskHost(rskTxHelper));
            };

            const callbacks = {
                pegoutCreatedCallback,
            };

            const btcBlockNumberBeforePegoutRelease = await btcTxHelper.getLatestBlockNumber();
            await triggerRelease(rskTxHelpers, btcTxHelper, callbacks);

            // Checking all the pegout events are emitted and in order
            const blockNumberAfterPegoutRelease = await rskTxHelper.getBlockNumber();
            const pegoutsEvents = await getPegoutEventsInBlockRange(
                rskTxHelper,
                pegoutTransaction.blockNumber,
                blockNumberAfterPegoutRelease
            );

            await assertSuccessfulPegoutEventsAreEmitted(
                rskTxHelper,
                pegoutsEvents,
                pegoutTransaction.transactionHash,
                senderRecipientInfo,
                pegoutValueInSatoshis,
                bridgeStateBeforePegoutCreation,
                bridgeStateAfterPegoutCreation
            );

            const pegoutBtcTransaction = bitcoinJsLib.Transaction.fromHex(
                bridgeStateAfterPegoutCreation.pegoutsWaitingForConfirmations[0].btcRawTx
            );
            assertSpentUtxosNotAvailableAnyMore(
                bridgeStateAfterPegoutCreation.activeFederationUtxos,
                pegoutBtcTransaction
            );

            await assert2wpBalanceAfterSuccessfulPegout(initial2wpBalances, pegoutValueInSatoshis);

            // Assert that the sender address balance is increased by the actual pegout value
            const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                btcTxHelper,
                senderRecipientInfo.btcSenderAddressInfo.address
            );
            const releaseBtcEvent = pegoutsEvents.at(-1);
            const releaseBtcTransaction = bitcoinJsLib.Transaction.fromHex(
                removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction)
            );
            const actualPegoutValueReceivedInSatoshis = Number(releaseBtcTransaction.outs[0].value);
            expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                initialSenderAddressBalanceInSatoshis + actualPegoutValueReceivedInSatoshis
            );

            // The pegout is mined in the first btc block after it was released
            const expectedUtxoHeight = btcBlockNumberBeforePegoutRelease + 1;
            await assertBtcTxIsMinedAtHeight(
                btcTxHelper,
                releaseBtcTransaction.getId(),
                expectedUtxoHeight
            );
            await assertChangeUtxoIsRegisteredInBridge(releaseBtcTransaction);
        });

        if (fullExecution) {
            it('should reject and refund a pegout with value exactly below minimum', async () => {
                // Arrange

                // Create a pegin for the sender to ensure there is enough funds to pegout and because this is the natural process
                const senderRecipientInfo = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper
                );
                await fundRskAccountThroughAPegin(
                    rskTxHelper,
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo
                );

                const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                const initialBtcRecipientAddressBalanceInSatoshis =
                    await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo.address
                    );
                const initialRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );
                // Value exactly below minimum
                const pegoutValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS - 1;

                // Act

                const pegoutTransaction = await sendTxToBridge(
                    rskTxHelper,
                    new BN(satoshisToWeis(pegoutValueInSatoshis)),
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );

                // Assert

                const expectedPegoutValue = satoshisToWeis(pegoutValueInSatoshis);
                await assertExpectedReleaseRequestRejectedEventIsEmitted(
                    rskTxHelper,
                    senderRecipientInfo.rskRecipientRskAddressInfo.address,
                    expectedPegoutValue,
                    PEGOUT_REJECTION_REASONS.LOW_AMOUNT
                );

                await assert2wpBalanceIsUnchanged(initial2wpBalances);

                // The rsk sender balance is the same as the initial balance minus the gas fee, because the pegout amount was refunded.
                const finalRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );
                const gasFee = pegoutTransaction.gasUsed * pegoutTransaction.effectiveGasPrice;
                const expectedRskSenderBalanceInWeisBN = initialRskSenderBalanceInWeisBN.sub(
                    new BN(`${gasFee}`)
                );
                expect(finalRskSenderBalanceInWeisBN.eq(expectedRskSenderBalanceInWeisBN)).to.be
                    .true;

                // The btc recipient address balance is the same as the initial balance, because the pegout didn't go though.
                const finalBtcRecipientBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo.address
                );
                expect(finalBtcRecipientBalanceInSatoshis).to.be.equal(
                    initialBtcRecipientAddressBalanceInSatoshis
                );
            });

            it('should reject and refund a pegout when fee per kb is above value', async () => {
                // Arrange

                // Create a pegin for the sender to ensure there is enough funds to pegout and because this is the natural process
                const senderRecipientInfo = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper
                );
                await fundRskAccountThroughAPegin(
                    rskTxHelper,
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo
                );

                const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                const initialBtcRecipientAddressBalanceInSatoshis =
                    await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        senderRecipientInfo.btcSenderAddressInfo.address
                    );
                const initialRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );
                const pegoutValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS;

                const initialFeePerKb = Number(await bridge.methods.getFeePerKb().call());
                // We just need a feePerKB that will cause the pegout to be rejected due to the FEE_ABOVE_VALUE reason.
                // This value is much larger than what we need, but the calculation is complex and based on estimation, so we cannot know for sure.
                // That's why we use a big enough value. MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS is perfect for this case.
                const newFeePerKbInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS;
                await setFeePerKb(rskTxHelper, newFeePerKbInSatoshis * 4); // Setting it to 4 times the pegout value to ensure the pegout is rejected, needed for segwit

                // Act

                const pegoutTransaction = await sendTxToBridge(
                    rskTxHelper,
                    new BN(satoshisToWeis(pegoutValueInSatoshis)),
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );

                // Assert

                const expectedPegoutValue = satoshisToWeis(pegoutValueInSatoshis);
                await assertExpectedReleaseRequestRejectedEventIsEmitted(
                    rskTxHelper,
                    senderRecipientInfo.rskRecipientRskAddressInfo.address,
                    expectedPegoutValue,
                    PEGOUT_REJECTION_REASONS.FEE_ABOVE_VALUE
                );

                await assert2wpBalanceIsUnchanged(initial2wpBalances);

                // The rsk sender balance is the same as the initial balance minus the gas fee, because the pegout amount was refunded.
                const finalRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );
                const gasFee = pegoutTransaction.gasUsed * pegoutTransaction.effectiveGasPrice;
                const expectedRskSenderBalanceInWeisBN = initialRskSenderBalanceInWeisBN.sub(
                    new BN(`${gasFee}`)
                );
                expect(finalRskSenderBalanceInWeisBN.eq(expectedRskSenderBalanceInWeisBN)).to.be
                    .true;

                // The btc recipient address balance is the same as the initial balance, because the pegout didn't go through.
                const finalBtcRecipientBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo.address
                );
                expect(finalBtcRecipientBalanceInSatoshis).to.be.equal(
                    initialBtcRecipientAddressBalanceInSatoshis
                );

                // Setting fee per kb back to its original value
                await setFeePerKb(rskTxHelper, initialFeePerKb);
            });

            it('should reject and not refund a pegout when a contract is trying to execute it', async () => {
                // Arrange

                const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                const pegoutValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS;

                const creatorAddress = await getNewFundedRskAddress(rskTxHelper);
                const callReleaseBtcContract = await deployCallReleaseBtcContract(
                    rskTxHelper,
                    creatorAddress
                );
                const initialRskSenderBalanceInWeisBN =
                    await rskTxHelper.getBalance(creatorAddress);
                const initialContractBalanceInWeisBN = await rskTxHelper.getBalance(
                    callReleaseBtcContract.options.address
                );

                // Act

                const callBridgeReleaseBtcMethod =
                    callReleaseBtcContract.methods.callBridgeReleaseBtc();
                const contractCallTxReceipt = await sendTransaction(
                    rskTxHelper,
                    callBridgeReleaseBtcMethod,
                    creatorAddress,
                    satoshisToWeis(pegoutValueInSatoshis)
                );

                // Assert

                const expectedPegoutValue = satoshisToWeis(pegoutValueInSatoshis);

                const contractAddressChecksummed = rskTxHelper
                    .getClient()
                    .utils.toChecksumAddress(ensure0x(callReleaseBtcContract.options.address));
                const expectedEvent = createExpectedReleaseRequestRejectedEvent(
                    contractAddressChecksummed,
                    expectedPegoutValue,
                    PEGOUT_REJECTION_REASONS.CALLER_CONTRACT
                );
                const actualReleaseRequestRejectedEvent =
                    getReleaseRequestRejectedEventFromContractCallTxReceipt(
                        rskTxHelper,
                        contractCallTxReceipt
                    );
                expect(actualReleaseRequestRejectedEvent).to.be.deep.equal(expectedEvent);

                await assert2wpBalancesAfterPegoutFromContract(
                    initial2wpBalances,
                    pegoutValueInSatoshis
                );

                // The rsk sender should lose the funds since there's no refund when a smart contract is trying to do a pegout
                const expectedRskSenderBalanceInWeisBN = initialRskSenderBalanceInWeisBN.sub(
                    new BN(`${satoshisToWeis(pegoutValueInSatoshis)}`)
                );
                const finalRskSenderBalanceInWeisBN = await rskTxHelper.getBalance(creatorAddress);
                expect(finalRskSenderBalanceInWeisBN.eq(expectedRskSenderBalanceInWeisBN)).to.be
                    .true;

                // The contract balance should be the same as the initial balance since the contract is not paying for the pegout
                const finalContractBalanceInWeisBN = await rskTxHelper.getBalance(
                    callReleaseBtcContract.options.address
                );
                expect(finalContractBalanceInWeisBN.eq(initialContractBalanceInWeisBN)).to.be.true;
            });

            it('should do a pegout and round down the weis to satoshis as expected', async () => {
                // Arrange

                const senderRecipientInfo = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper
                );
                await fundRskAccountThroughAPegin(
                    rskTxHelper,
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo
                );

                const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
                const initialSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo.address
                );
                const pegoutValueInWeisBN = new BN('41234567891234560'); // 0.04123456789123456 in RBTC
                const expectedPegoutValueInSatoshis = 4123456; // 0.04123456 in BTC

                const bridgeStateBeforePegoutCreation = await getBridgeState(
                    getRskHost(rskTxHelper)
                );

                // Act

                const pegoutTransaction = await sendTxToBridge(
                    rskTxHelper,
                    pegoutValueInWeisBN,
                    senderRecipientInfo.rskRecipientRskAddressInfo.address
                );

                // Assert

                let bridgeStateAfterPegoutCreation;

                // Callback to get the bridge state after the pegout is created
                const pegoutCreatedCallback = async () => {
                    bridgeStateAfterPegoutCreation = await getBridgeState(getRskHost(rskTxHelper));
                };

                const callbacks = {
                    pegoutCreatedCallback,
                };

                const btcBlockNumberBeforePegoutRelease = await btcTxHelper.getLatestBlockNumber();
                await triggerRelease(rskTxHelpers, btcTxHelper, callbacks);

                // Checking all the pegout events are emitted and in order
                const blockNumberAfterPegoutRelease = await rskTxHelper.getBlockNumber();
                const pegoutsEvents = await getPegoutEventsInBlockRange(
                    rskTxHelper,
                    pegoutTransaction.blockNumber,
                    blockNumberAfterPegoutRelease
                );
                await assertSuccessfulPegoutEventsAreEmitted(
                    rskTxHelper,
                    pegoutsEvents,
                    pegoutTransaction.transactionHash,
                    senderRecipientInfo,
                    expectedPegoutValueInSatoshis,
                    bridgeStateBeforePegoutCreation,
                    bridgeStateAfterPegoutCreation,
                    pegoutValueInWeisBN
                );

                const pegoutBtcTransaction = bitcoinJsLib.Transaction.fromHex(
                    bridgeStateAfterPegoutCreation.pegoutsWaitingForConfirmations[0].btcRawTx
                );
                assertSpentUtxosNotAvailableAnyMore(
                    bridgeStateAfterPegoutCreation.activeFederationUtxos,
                    pegoutBtcTransaction
                );

                await assert2wpBalanceAfterSuccessfulPegoutWithLargeWeis(
                    initial2wpBalances,
                    pegoutValueInWeisBN,
                    expectedPegoutValueInSatoshis
                );

                // Assert that the sender address balance is increased by the actual pegout value
                const finalSenderAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo.btcSenderAddressInfo.address
                );
                const releaseBtcEvent = pegoutsEvents.at(-1);
                const releaseBtcTransaction = bitcoinJsLib.Transaction.fromHex(
                    removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction)
                );
                const actualPegoutValueReceivedInSatoshis = Number(
                    releaseBtcTransaction.outs[0].value
                );
                expect(finalSenderAddressBalanceInSatoshis).to.be.equal(
                    initialSenderAddressBalanceInSatoshis + actualPegoutValueReceivedInSatoshis
                );

                // The pegout is mined in the first btc block after it was released
                const expectedUtxoHeight = btcBlockNumberBeforePegoutRelease + 1;
                await assertBtcTxIsMinedAtHeight(
                    btcTxHelper,
                    releaseBtcTransaction.getId(),
                    expectedUtxoHeight
                );
                await assertChangeUtxoIsRegisteredInBridge(releaseBtcTransaction);
            });

            it('should create multiple pegouts with mixed values same and above minimum', async () => {
                // Arrange

                const senderRecipientInfo1 = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper
                );
                await fundRskAccountThroughAPegin(
                    rskTxHelper,
                    btcTxHelper,
                    senderRecipientInfo1.btcSenderAddressInfo
                );

                const senderRecipientInfo2 = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper
                );
                await fundRskAccountThroughAPegin(
                    rskTxHelper,
                    btcTxHelper,
                    senderRecipientInfo2.btcSenderAddressInfo
                );

                const senderRecipientInfo3 = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper
                );
                await fundRskAccountThroughAPegin(
                    rskTxHelper,
                    btcTxHelper,
                    senderRecipientInfo3.btcSenderAddressInfo
                );

                const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);

                const initialSender1AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo1.btcSenderAddressInfo.address
                );
                const initialSender2AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo2.btcSenderAddressInfo.address
                );
                const initialSender3AddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo3.btcSenderAddressInfo.address
                );

                const pegout1ValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS;
                const pegout2ValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS + 100_000;
                const pegout3ValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS + 150_000;
                const totalPegoutValueInSatoshis =
                    pegout1ValueInSatoshis + pegout2ValueInSatoshis + pegout3ValueInSatoshis;

                const bridgeStateBeforePegoutCreation = await getBridgeState(
                    getRskHost(rskTxHelper)
                );

                // Act
                const shouldMine = false;
                const pegoutTransaction1Promise = sendTxToBridge(
                    rskTxHelper,
                    new BN(satoshisToWeis(pegout1ValueInSatoshis)),
                    senderRecipientInfo1.rskRecipientRskAddressInfo.address,
                    shouldMine
                );
                const pegoutTransaction2Promise = sendTxToBridge(
                    rskTxHelper,
                    new BN(satoshisToWeis(pegout2ValueInSatoshis)),
                    senderRecipientInfo2.rskRecipientRskAddressInfo.address,
                    shouldMine
                );
                const pegoutTransaction3 = await sendTxToBridge(
                    rskTxHelper,
                    new BN(satoshisToWeis(pegout3ValueInSatoshis)),
                    senderRecipientInfo3.rskRecipientRskAddressInfo.address
                );

                // After mining, we can get the transaction receipts.
                const pegoutTransaction1 = await pegoutTransaction1Promise;
                const pegoutTransaction2 = await pegoutTransaction2Promise;

                // Assert

                const bridgeStateAfterPegoutRequestsReceived = await getBridgeState(
                    getRskHost(rskTxHelper)
                );
                const pegoutRequests = bridgeStateAfterPegoutRequestsReceived.pegoutRequests;

                expect(pegoutRequests.length).to.be.equal(3);

                // They could be in any order, so we need to find them.
                const pegoutRequest1 = findPegoutRequest(
                    pegoutRequests,
                    pegoutTransaction1.transactionHash
                );
                const pegoutRequest2 = findPegoutRequest(
                    pegoutRequests,
                    pegoutTransaction2.transactionHash
                );
                const pegoutRequest3 = findPegoutRequest(
                    pegoutRequests,
                    pegoutTransaction3.transactionHash
                );

                // Assert that the pegout requests are in the Bridge
                assertBridgePegoutRequest(
                    pegoutRequest1,
                    base58AddressToHash160(senderRecipientInfo1.btcSenderAddressInfo.address),
                    pegout1ValueInSatoshis,
                    pegoutTransaction1.transactionHash
                );
                assertBridgePegoutRequest(
                    pegoutRequest2,
                    base58AddressToHash160(senderRecipientInfo2.btcSenderAddressInfo.address),
                    pegout2ValueInSatoshis,
                    pegoutTransaction2.transactionHash
                );
                assertBridgePegoutRequest(
                    pegoutRequest3,
                    base58AddressToHash160(senderRecipientInfo3.btcSenderAddressInfo.address),
                    pegout3ValueInSatoshis,
                    pegoutTransaction3.transactionHash
                );

                let bridgeStateAfterPegoutCreation;

                // Callback to get the bridge state after the pegout is created
                const pegoutCreatedCallback = async () => {
                    bridgeStateAfterPegoutCreation = await getBridgeState(getRskHost(rskTxHelper));
                };

                const callbacks = {
                    pegoutCreatedCallback,
                };

                const btcBlockNumberBeforePegoutRelease = await btcTxHelper.getLatestBlockNumber();
                await triggerRelease(rskTxHelpers, btcTxHelper, callbacks);

                // Checking all the pegout events are emitted and in order
                const blockNumberAfterPegoutRelease = await rskTxHelper.getBlockNumber();
                const pegoutEvents = await getPegoutEventsInBlockRange(
                    rskTxHelper,
                    pegoutTransaction1.blockNumber,
                    blockNumberAfterPegoutRelease
                );

                // The release_request_received event of the first pegout request
                const sender1RskAddress = rskTxHelper
                    .getClient()
                    .utils.toChecksumAddress(
                        ensure0x(senderRecipientInfo1.rskRecipientRskAddressInfo.address)
                    );
                const sender1BtcAddress = senderRecipientInfo1.btcSenderAddressInfo.address;
                assertReleaseRequestReceivedEvent(
                    pegoutEvents,
                    sender1RskAddress,
                    sender1BtcAddress,
                    satoshisToWeis(pegout1ValueInSatoshis)
                );

                // The release_request_received event of the second pegout request
                const sender2RskAddress = rskTxHelper
                    .getClient()
                    .utils.toChecksumAddress(
                        ensure0x(senderRecipientInfo2.rskRecipientRskAddressInfo.address)
                    );
                const sender2BtcAddress = senderRecipientInfo2.btcSenderAddressInfo.address;
                assertReleaseRequestReceivedEvent(
                    pegoutEvents,
                    sender2RskAddress,
                    sender2BtcAddress,
                    satoshisToWeis(pegout2ValueInSatoshis)
                );

                // The release_request_received event of the third pegout request
                const sender3RskAddress = rskTxHelper
                    .getClient()
                    .utils.toChecksumAddress(
                        ensure0x(senderRecipientInfo3.rskRecipientRskAddressInfo.address)
                    );
                const sender3BtcAddress = senderRecipientInfo3.btcSenderAddressInfo.address;
                assertReleaseRequestReceivedEvent(
                    pegoutEvents,
                    sender3RskAddress,
                    sender3BtcAddress,
                    satoshisToWeis(pegout3ValueInSatoshis)
                );

                const pegoutWaitingForConfirmationWhenPegoutWasCreated =
                    bridgeStateAfterPegoutCreation.pegoutsWaitingForConfirmations[0];
                const btcTransaction = bitcoinJsLib.Transaction.fromHex(
                    pegoutWaitingForConfirmationWhenPegoutWasCreated.btcRawTx
                );
                const pegoutCreationRskTransactionHash = ensure0x(
                    pegoutWaitingForConfirmationWhenPegoutWasCreated.rskTxHash
                );

                // Release requested events
                const releaseRequestedEvent = pegoutEvents[3];
                assertReleaseRequestedEvent(
                    releaseRequestedEvent,
                    pegoutCreationRskTransactionHash,
                    btcTransaction.getId(),
                    totalPegoutValueInSatoshis
                );

                const pegoutTransactionCreatedEvent = pegoutEvents[4];
                assertPegoutTransactionCreatedEventIsEmitted(
                    pegoutTransactionCreatedEvent,
                    btcTransaction,
                    bridgeStateBeforePegoutCreation
                );

                // batch_pegout_created event
                const batchPegoutCreatedEvent = pegoutEvents[5];
                assertBatchPegoutCreatedEvent(batchPegoutCreatedEvent, btcTransaction.getId(), [
                    pegoutTransaction1.transactionHash,
                    pegoutTransaction2.transactionHash,
                    pegoutTransaction3.transactionHash,
                ]);

                // pegout_confirmed event
                const pegoutConfirmedEvent = pegoutEvents[6];
                assertPegoutConfirmedEvent(
                    pegoutConfirmedEvent,
                    btcTransaction.getId(),
                    pegoutWaitingForConfirmationWhenPegoutWasCreated.pegoutCreationBlockNumber
                );

                // add_signature events
                const addSignatureEvents = pegoutEvents.slice(7, -1);
                await assertAddSignatureEvents(
                    rskTxHelper,
                    addSignatureEvents,
                    releaseRequestedEvent
                );

                // release_btc event
                const releaseBtcEvent = pegoutEvents.at(-1);
                assertReleaseBtcEvent(releaseBtcEvent, releaseRequestedEvent);

                assertSpentUtxosNotAvailableAnyMore(
                    bridgeStateAfterPegoutCreation.activeFederationUtxos,
                    btcTransaction
                );

                await assert2wpBalanceAfterSuccessfulPegout(
                    initial2wpBalances,
                    totalPegoutValueInSatoshis
                );

                const releaseBtcTransaction = bitcoinJsLib.Transaction.fromHex(
                    removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction)
                );

                // Asserting actual value received for sender 1
                const finalSenderAddressBalanceInSatoshis1 = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo1.btcSenderAddressInfo.address
                );
                const sender1Utxo = getAddressUtxo(
                    releaseBtcTransaction.outs,
                    senderRecipientInfo1.btcSenderAddressInfo.address
                );
                expect(finalSenderAddressBalanceInSatoshis1).to.be.equal(
                    initialSender1AddressBalanceInSatoshis + Number(sender1Utxo.value)
                );

                // Asserting actual value received for sender 2
                const finalSenderAddressBalanceInSatoshis2 = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo2.btcSenderAddressInfo.address
                );
                const sender2Utxo = getAddressUtxo(
                    releaseBtcTransaction.outs,
                    senderRecipientInfo2.btcSenderAddressInfo.address
                );
                expect(finalSenderAddressBalanceInSatoshis2).to.be.equal(
                    initialSender2AddressBalanceInSatoshis + Number(sender2Utxo.value)
                );

                // Asserting actual value received for sender 3
                const finalSenderAddressBalanceInSatoshis3 = await getBtcAddressBalanceInSatoshis(
                    btcTxHelper,
                    senderRecipientInfo3.btcSenderAddressInfo.address
                );
                const sender3Utxo = getAddressUtxo(
                    releaseBtcTransaction.outs,
                    senderRecipientInfo3.btcSenderAddressInfo.address
                );
                expect(finalSenderAddressBalanceInSatoshis3).to.be.equal(
                    initialSender3AddressBalanceInSatoshis + Number(sender3Utxo.value)
                );

                // The pegout is mined in the first btc block after it was released
                const expectedUtxoHeight = btcBlockNumberBeforePegoutRelease + 1;
                await assertBtcTxIsMinedAtHeight(
                    btcTxHelper,
                    releaseBtcTransaction.getId(),
                    expectedUtxoHeight
                );
                await assertChangeUtxoIsRegisteredInBridge(releaseBtcTransaction);
            });

            it('should split pegout requests into multiple btc transactions when the batched pegout exceeds the max tx size allowed', async () => {
                // Arrange
                // This test forces the Bridge to split a batched pegout into multiple btc txs, where each split
                // `release_requested` must log its own partial value.

                // The batched pegout gets past the max tx size through its outputs, one per pegout request.
                // Enough requests that all of them together go past the max tx size, while half of them fit in a single btc tx.
                const extraPegoutRequestsToExceedSize = 150;
                const pegoutRequestsCount =
                    Math.ceil(MAX_STANDARD_TX_SIZE_ALLOWED / P2PKH_OUTPUT_SIZE_IN_BYTES) +
                    extraPegoutRequestsToExceedSize;
                const pegoutRequestValueInSatoshis = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS * 2;
                const pegoutRequestValueInWeis = new BN(
                    satoshisToWeis(pegoutRequestValueInSatoshis)
                );

                // A few big UTXOs, so that each split is funded by a few inputs. Their value is not a
                // multiple of a split's value, so that every split leaves a change output to register.
                const federationUtxoValueInBtc = 5;
                const federationUtxosCount = 6;
                const feesFundingInBtc = 1;
                const seederInfo = await createSenderRecipientInfo(
                    rskTxHelper,
                    btcTxHelper,
                    'legacy',
                    federationUtxoValueInBtc * federationUtxosCount + feesFundingInBtc
                );
                const seedingPeginBtcTxHash = await sendPeginToActiveFederation(
                    rskTxHelper,
                    btcTxHelper,
                    seederInfo.btcSenderAddressInfo,
                    new Array(federationUtxosCount).fill(federationUtxoValueInBtc)
                );
                await ensureBtcTxIsRegistered(
                    rskTxHelper,
                    seedingPeginBtcTxHash,
                    federationUtxosCount
                );

                const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);

                // The requests are spread over several senders, and sent in rounds of a few requests per sender.
                // Each round fits in the blocks mined after it.
                const pegoutSendersCount = 25;
                const pegoutRequestsPerSenderPerRound = 4;
                const blocksToMinePerRound = 2;
                const roundsCount = Math.ceil(
                    pegoutRequestsCount / (pegoutSendersCount * pegoutRequestsPerSenderPerRound)
                );
                const pegoutRequestsPerSender = roundsCount * pegoutRequestsPerSenderPerRound;
                const totalPegoutRequestsCount = pegoutRequestsPerSender * pegoutSendersCount;

                // Each sender is created with a known btc/rsk key pair, so its pegouts go to a btc
                // address we can check afterwards
                const pegoutRequestGasFundingInRbtc = 1;
                const pegoutSenderFundingInWeis = new BN(
                    satoshisToWeis(pegoutRequestValueInSatoshis * pegoutRequestsPerSender)
                ).add(new BN(ethToWeis(pegoutRequestGasFundingInRbtc)));
                const pegoutSenders = [];
                for (let senderIndex = 0; senderIndex < pegoutSendersCount; senderIndex++) {
                    const senderRecipientInfo = await createSenderRecipientInfo(
                        rskTxHelper,
                        btcTxHelper,
                        'legacy',
                        0 // don't fund the btc address; it's only the pegout destination
                    );
                    await sendFromCow(
                        rskTxHelper,
                        senderRecipientInfo.rskRecipientRskAddressInfo.address,
                        pegoutSenderFundingInWeis.toString()
                    );
                    pegoutSenders.push(senderRecipientInfo);
                }

                const initialRecipientBalancesInSatoshis = [];
                for (const sender of pegoutSenders) {
                    initialRecipientBalancesInSatoshis.push(
                        await getBtcAddressBalanceInSatoshis(
                            btcTxHelper,
                            sender.btcSenderAddressInfo.address
                        )
                    );
                }

                // Act
                // Every request is queued in the Bridge before any of them is batched: the federators do not
                // call updateCollections on their own, so nothing is batched until the release is triggered.
                const pegoutTransactions = [];
                for (let roundIndex = 0; roundIndex < roundsCount; roundIndex++) {
                    // Unlocked again every round, so that a long run of rounds does not outlast the unlock
                    await Promise.all(
                        pegoutSenders.map((sender) =>
                            rskTxHelper.unlockAccount(sender.rskRecipientRskAddressInfo.address)
                        )
                    );
                    const pendingPegoutRequests = pegoutSenders.flatMap((sender) =>
                        new Array(pegoutRequestsPerSenderPerRound)
                            .fill(sender.rskRecipientRskAddressInfo.address)
                            .map((senderAddress) =>
                                sendPegoutRequestToMempool(senderAddress, pegoutRequestValueInWeis)
                            )
                    );
                    await Promise.all(
                        pendingPegoutRequests.map(
                            (pendingPegoutRequest) => pendingPegoutRequest.inMempool
                        )
                    );
                    await mineAndSync(rskTxHelpers, blocksToMinePerRound);
                    pegoutTransactions.push(
                        ...(await Promise.all(
                            pendingPegoutRequests.map(
                                (pendingPegoutRequest) => pendingPegoutRequest.mined
                            )
                        ))
                    );
                }
                expect(pegoutTransactions.length).to.be.equal(totalPegoutRequestsCount);

                // All pegout requests should be waiting in the Bridge queue before being batched.
                const bridgeStateAfterPegoutRequestsReceived = await getBridgeState(
                    getRskHost(rskTxHelper)
                );
                const pegoutRequests = bridgeStateAfterPegoutRequestsReceived.pegoutRequests;
                expect(pegoutRequests.length).to.be.equal(totalPegoutRequestsCount);

                const firstPegoutRequestBlockNumber = Math.min(
                    ...pegoutTransactions.map((pegoutTransaction) => pegoutTransaction.blockNumber)
                );

                // Drive the full release until the whole pegout pipeline is drained: create,
                // broadcast and register the change of every tx
                const { drained, releaseCycles } = await triggerReleaseUntilPipelineDrained(
                    rskTxHelpers,
                    btcTxHelper
                );
                expect(
                    drained,
                    `The pegout pipeline should be fully drained (gave up after ${releaseCycles} release cycles).`
                ).to.be.true;

                // Collect the pegout events emitted while the requests were received and batched.
                const blockNumberAfterPegoutCreation = await rskTxHelper.getBlockNumber();
                const pegoutsEvents = await getPegoutEventsInBlockRange(
                    rskTxHelper,
                    firstPegoutRequestBlockNumber,
                    blockNumberAfterPegoutCreation
                );

                // One release_request_received per pegout request, each logging its own value.
                const releaseRequestReceivedEvents = pegoutsEvents.filter(
                    (event) => event.signature === PEGOUT_EVENTS.RELEASE_REQUEST_RECEIVED.signature
                );
                expect(releaseRequestReceivedEvents.length).to.be.equal(totalPegoutRequestsCount);

                for (const sender of pegoutSenders) {
                    const senderRskAddress = rskTxHelper
                        .getClient()
                        .utils.toChecksumAddress(
                            ensure0x(sender.rskRecipientRskAddressInfo.address)
                        );
                    const senderBtcAddress = sender.btcSenderAddressInfo.address;
                    const senderReleaseRequestReceivedEvents = releaseRequestReceivedEvents.filter(
                        (event) => event.arguments.sender === senderRskAddress
                    );
                    expect(
                        senderReleaseRequestReceivedEvents.length,
                        `Sender ${senderRskAddress} should have one release_request_received event per pegout request it sent.`
                    ).to.be.equal(pegoutRequestsPerSender);
                    for (const senderReleaseRequestReceivedEvent of senderReleaseRequestReceivedEvents) {
                        assertReleaseRequestReceivedEvent(
                            [senderReleaseRequestReceivedEvent],
                            senderRskAddress,
                            senderBtcAddress,
                            pegoutRequestValueInWeis
                        );
                    }
                }

                // The batch was split into at least two btc transactions, one batch_pegout_created /
                // release_requested per split tx.
                const batchPegoutCreatedEvents = pegoutsEvents.filter(
                    (event) => event.signature === PEGOUT_EVENTS.BATCH_PEGOUT_CREATED.signature
                );
                expect(
                    batchPegoutCreatedEvents.length,
                    'The batched pegout should have been split into at least two btc transactions.'
                ).to.be.at.least(2);
                const releaseRequestedEvents = pegoutsEvents.filter(
                    (event) => event.signature === PEGOUT_EVENTS.RELEASE_REQUESTED.signature
                );
                expect(releaseRequestedEvents.length).to.be.equal(batchPegoutCreatedEvents.length);

                // Every split's release_requested logs only the value of the requests batched
                // into that tx (the split value), and across all splits the logged values add up to
                // exactly the total pegged out
                const totalPegoutValueInSatoshis =
                    pegoutRequestValueInSatoshis * totalPegoutRequestsCount;
                let totalValueLoggedInSatoshis = 0;
                for (const batchPegoutCreatedEvent of batchPegoutCreatedEvents) {
                    const batchBtcTxHash = removePrefix0x(
                        batchPegoutCreatedEvent.arguments.btcTxHash
                    );
                    const releaseRequestedEvent = releaseRequestedEvents.find(
                        (event) => removePrefix0x(event.arguments.btcTxHash) === batchBtcTxHash
                    );
                    expect(
                        releaseRequestedEvent,
                        `A release_requested event should be emitted for the split btc tx ${batchBtcTxHash}.`
                    ).to.not.be.undefined;

                    // The release_requested rskTxHash should be the rsk tx that created this split,
                    // i.e. the one that emitted its batch_pegout_created event
                    const batchPegoutCreatedEventInSplitCreationTx = await findEventInTx(
                        rskTxHelper,
                        releaseRequestedEvent.arguments.rskTxHash,
                        PEGOUT_EVENTS.BATCH_PEGOUT_CREATED.name,
                        bridge.options.jsonInterface
                    );
                    expect(
                        batchPegoutCreatedEventInSplitCreationTx,
                        `The rsk tx ${releaseRequestedEvent.arguments.rskTxHash} should have created the split btc tx ${batchBtcTxHash}.`
                    ).to.not.be.undefined;
                    expect(
                        removePrefix0x(batchPegoutCreatedEventInSplitCreationTx.args.btcTxHash)
                    ).to.be.equal(batchBtcTxHash);

                    const requestsInThisSplitCount = pegoutTransactions.filter(
                        (pegoutTransaction) =>
                            batchPegoutCreatedEvent.arguments.releaseRskTxHashes.includes(
                                removePrefix0x(pegoutTransaction.transactionHash)
                            )
                    ).length;
                    expect(Number(releaseRequestedEvent.arguments.amount)).to.be.equal(
                        requestsInThisSplitCount * pegoutRequestValueInSatoshis
                    );

                    totalValueLoggedInSatoshis += Number(releaseRequestedEvent.arguments.amount);
                }
                expect(totalValueLoggedInSatoshis).to.be.equal(totalPegoutValueInSatoshis);

                // Verify the resulting split btc transactions.
                const releaseBtcEvents = pegoutsEvents.filter(
                    (event) => event.signature === PEGOUT_EVENTS.RELEASE_BTC.signature
                );
                expect(releaseBtcEvents.length).to.be.equal(batchPegoutCreatedEvents.length);

                const releaseBtcTransactions = releaseBtcEvents.map((releaseBtcEvent) =>
                    bitcoinJsLib.Transaction.fromHex(
                        removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction)
                    )
                );
                for (const releaseBtcTransaction of releaseBtcTransactions) {
                    expect(
                        releaseBtcTransaction.virtualSize(),
                        `Each split pegout tx virtual size should be at most the max standard tx size allowed (${MAX_STANDARD_TX_SIZE_ALLOWED}).`
                    ).to.be.at.most(MAX_STANDARD_TX_SIZE_ALLOWED);

                    await ensureBtcTxIsRegistered(rskTxHelper, releaseBtcTransaction.getId());
                    await assertChangeUtxoIsRegisteredInBridge(releaseBtcTransaction);
                }

                // Every pegout request of a sender pays its btc address once, in one of the split txs,
                // and the address balance grew by all of those outputs.
                const allSplitsOutputs = releaseBtcTransactions.flatMap(
                    (releaseBtcTransaction) => releaseBtcTransaction.outs
                );
                for (let i = 0; i < pegoutSenders.length; i++) {
                    const recipientAddress = pegoutSenders[i].btcSenderAddressInfo.address;
                    const recipientOutputs = getOutputsToAddress(
                        allSplitsOutputs,
                        recipientAddress
                    );
                    expect(
                        recipientOutputs.length,
                        `Recipient ${recipientAddress} should have one output per pegout request it sent.`
                    ).to.be.equal(pegoutRequestsPerSender);

                    const recipientOutputsValueInSatoshis = recipientOutputs.reduce(
                        (sum, output) => sum + Number(output.value),
                        0
                    );
                    const finalRecipientBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(
                        btcTxHelper,
                        recipientAddress
                    );
                    expect(finalRecipientBalanceInSatoshis).to.be.equal(
                        initialRecipientBalancesInSatoshis[i] + recipientOutputsValueInSatoshis
                    );
                }

                // assert final balance
                await assert2wpBalanceAfterSuccessfulPegout(
                    initial2wpBalances,
                    totalPegoutValueInSatoshis
                );
            });
        } // end if (fullExecution) — pegout full-only tests
    });
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

    expect(final2wpBalances.federationAddressBalanceInSatoshis).to.be.equal(
        initial2wpBalances.federationAddressBalanceInSatoshis + peginValueInSatoshis
    );

    expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(
        initial2wpBalances.bridgeUtxosBalanceInSatoshis
    );

    expect(final2wpBalances.bridgeBalanceInWeisBN.eq(initial2wpBalances.bridgeBalanceInWeisBN)).to
        .be.true;
};

const assertPeginTxHashNotProcessed = async (btcPeginTxHash) => {
    const isBtcTxHashAlreadyProcessed = await bridge.methods
        .isBtcTxHashAlreadyProcessed(btcPeginTxHash)
        .call();
    expect(isBtcTxHashAlreadyProcessed).to.be.false;
    const btcTxHashProcessedHeight = Number(
        await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call()
    );
    expect(btcTxHashProcessedHeight).to.be.equal(-1);
};

const assert2wpBalanceIsUnchanged = async (initial2wpBalances) => {
    const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
    expect(final2wpBalances).to.be.deep.equal(initial2wpBalances);
};

const assert2wpBalancesAfterPegoutFromContract = async (
    initial2wpBalances,
    pegoutValueInSatoshis
) => {
    const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);

    expect(final2wpBalances.federationAddressBalanceInSatoshis).to.be.equal(
        initial2wpBalances.federationAddressBalanceInSatoshis
    );

    expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(
        initial2wpBalances.bridgeUtxosBalanceInSatoshis
    );
    // When a contract sends funds to the Bridge to try to do a pegout, the pegout is rejected and the Bridge rsk balance is increased by the pegout value
    // because there's no refund when a contract is trying to do a pegout.
    const expectedBridgeBalanceInWeisBN = initial2wpBalances.bridgeBalanceInWeisBN.add(
        new BN(satoshisToWeis(pegoutValueInSatoshis))
    );

    expect(final2wpBalances.bridgeBalanceInWeisBN.eq(expectedBridgeBalanceInWeisBN)).to.be.true;
};

const assertBtcPeginTxHashProcessed = async (btcPeginTxHash) => {
    const isBtcTxHashAlreadyProcessed = await bridge.methods
        .isBtcTxHashAlreadyProcessed(btcPeginTxHash)
        .call();
    expect(isBtcTxHashAlreadyProcessed).to.be.true;
};

/**
 * Asserts the 2wp balances after a successful pegout, ensuring that the federation balance is decreased by the pegout value, the bridge rsk balance is increased by the pegout value and the bridge utxos balance is decreased by the pegout value.
 * @param {{federationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}} initial2wpBalances
 * @param {number} pegoutValueInRbtc the value in RBTC of the pegout
 */
const assert2wpBalanceAfterSuccessfulPegout = async (initial2wpBalances, pegoutValueInSatoshis) => {
    const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);

    expect(final2wpBalances.federationAddressBalanceInSatoshis).to.be.equal(
        initial2wpBalances.federationAddressBalanceInSatoshis - pegoutValueInSatoshis
    );

    const expectedFinalBridgeBalancesInWeisBN = initial2wpBalances.bridgeBalanceInWeisBN.add(
        new BN(satoshisToWeis(pegoutValueInSatoshis))
    );
    expect(final2wpBalances.bridgeBalanceInWeisBN.eq(expectedFinalBridgeBalancesInWeisBN)).to.be
        .true;

    expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(
        initial2wpBalances.bridgeUtxosBalanceInSatoshis - pegoutValueInSatoshis
    );
};

/**
 * Asserts the 2wp balances after a successful pegout, ensuring that the federation balance is decreased by the expected rounded pegout value in satoshis,
 * the bridge rsk balance is increased by the pegout value with many decimals and the bridge utxos balance is decreased by the expected rounded pegout value in satoshis.
 * When there is a pegout with big value in weis, that is not fully converted to satoshis and part of it needs to be trimmed.
 * Bridge rsk balance will be slightly bigger than the federation balance due to this mismatch, since the Bridge will keep
 * those trimmed weis while the federation will not.
 * @param {{federationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}} initial2wpBalances
 * @param {BN} pegoutValueInWeisBN the value in BN of the pegout
 * @param {number} expectedPegoutValueInSatoshis the expected pegout value in satoshis the user will receive, rounded down.
 */
const assert2wpBalanceAfterSuccessfulPegoutWithLargeWeis = async (
    initial2wpBalances,
    pegoutValueInWeisBN,
    expectedPegoutValueInSatoshis
) => {
    const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);

    expect(final2wpBalances.federationAddressBalanceInSatoshis).to.be.equal(
        initial2wpBalances.federationAddressBalanceInSatoshis - expectedPegoutValueInSatoshis
    );

    const expectedFinalBridgeBalancesInWeisBN =
        initial2wpBalances.bridgeBalanceInWeisBN.add(pegoutValueInWeisBN);

    expect(final2wpBalances.bridgeBalanceInWeisBN.eq(expectedFinalBridgeBalancesInWeisBN)).to.be
        .true;

    expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(
        initial2wpBalances.bridgeUtxosBalanceInSatoshis - expectedPegoutValueInSatoshis
    );
};

const getAddressUtxo = (outputs, address) => {
    return outputs.find((output) => {
        const outputAddress = bitcoinJsLib.address.fromOutputScript(
            output.script,
            btcTxHelper.btcConfig.network
        );
        return outputAddress === address;
    });
};

const assertBridgePegoutRequest = (
    pegoutRequest,
    btcDestinationAddressHash160,
    amountInSatoshis,
    rskTxHash
) => {
    expect(pegoutRequest.destinationAddressHash160).to.be.equal(btcDestinationAddressHash160);
    expect(Number(pegoutRequest.amountInSatoshis)).to.be.equal(amountInSatoshis);
    expect(ensure0x(pegoutRequest.rskTxHash)).to.be.equal(rskTxHash);
};

/**
 *
 * @param {Array<PegoutRequest>} bridgePegoutRequests the pegout requests array from the bridge state
 * @param {string} rskTxHash the tx hash of the pegout request
 * @returns {PegoutRequest | undefined} the pegout request object from the bridge state, or undefined if not found
 */
const findPegoutRequest = (bridgePegoutRequests, rskTxHash) => {
    return bridgePegoutRequests.find(
        (pegoutRequest) => ensure0x(pegoutRequest.rskTxHash) === rskTxHash
    );
};

const assertPeginUtxoIsRegisteredInBridge = async (
    btcPeginTxHash,
    peginValueInSatoshis,
    btcBlockNumberBeforeSendingPegin
) => {
    await assertUtxosRegisteredEventIsEmitted(
        rskTxHelper,
        btcTxHelper,
        btcPeginTxHash,
        federationAddress
    );

    // The pegin is mined in the first btc block after it was sent
    const expectedUtxoHeight = btcBlockNumberBeforeSendingPegin + 1;
    await assertBtcTxIsMinedAtHeight(btcTxHelper, btcPeginTxHash, expectedUtxoHeight);
    const expectedPeginUtxo = createExpectedUtxo(
        btcPeginTxHash,
        PEGIN_OUTPUT_INDEX_TO_FEDERATION,
        peginValueInSatoshis,
        expectedUtxoHeight
    );
    await assertUtxosAreRegisteredInActiveFederationUtxos(rskTxHelper, btcPeginTxHash, [
        expectedPeginUtxo,
    ]);
};

const assertChangeUtxoIsRegisteredInBridge = async (releaseBtcTransaction) => {
    // The change is the last output of the pegout transaction
    const releaseBtcTxId = releaseBtcTransaction.getId();
    const changeOutputIndex = releaseBtcTransaction.outs.length - 1;
    const valueInSatoshis = Number(releaseBtcTransaction.outs[changeOutputIndex].value);
    const releaseBtcTxBlockHeight = await getBtcTxBlockHeight(btcTxHelper, releaseBtcTxId);
    const expectedChangeUtxo = createExpectedUtxo(
        releaseBtcTxId,
        changeOutputIndex,
        valueInSatoshis,
        releaseBtcTxBlockHeight
    );
    await assertUtxosAreRegisteredInActiveFederationUtxos(rskTxHelper, releaseBtcTxId, [
        expectedChangeUtxo,
    ]);

    await assertUtxosRegisteredEventIsEmitted(
        rskTxHelper,
        btcTxHelper,
        releaseBtcTxId,
        federationAddress
    );
};

/**
 * Sends a pegout request without mining it.
 * @param {string} senderAddress an unlocked rsk address with enough funds
 * @param {BN} valueInWeisBN the value to peg out
 * @returns {{inMempool: Promise<string>, mined: Promise<object>}} `inMempool` resolves with the tx
 * hash once the node accepted the tx into its mempool, `mined` with its receipt once it is mined
 */
const sendPegoutRequestToMempool = (senderAddress, valueInWeisBN) => {
    const txPromiEvent = rskTxHelper.getClient().eth.sendTransaction({
        from: senderAddress,
        to: BRIDGE_ADDRESS,
        value: valueInWeisBN,
        gas: PEGOUT_REQUEST_GAS_LIMIT,
        gasPrice: PEGOUT_REQUEST_GAS_PRICE,
    });
    const inMempool = new Promise((resolve, reject) => {
        txPromiEvent.once('transactionHash', resolve);
        txPromiEvent.once('error', reject);
    });
    return { inMempool, mined: Promise.resolve(txPromiEvent) };
};

const getOutputsToAddress = (outputs, address) => {
    return outputs.filter((output) => {
        const outputAddress = bitcoinJsLib.address.fromOutputScript(
            output.script,
            btcTxHelper.btcConfig.network
        );
        return outputAddress === address;
    });
};

const executeShort = (description) => {
    execute(description, false);
};

const executeFull = (description) => {
    execute(description, true);
};

module.exports = {
    execute,
    executeShort,
    executeFull,
};
