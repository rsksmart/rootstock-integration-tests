const expect = require('chai').expect;
const bitcoinJsLib = require('bitcoinjs-lib');
const { satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { getBridge } = require('../bridge-provider');
const { ensure0x, removePrefix0x } = require('../utils');
const { decodeOutpointValues } = require('../varint');
const { PEGIN_EVENTS } = require('../constants/pegin-constants');
const { PEGOUT_EVENTS } = require('../constants/pegout-constants');
const {
    findEventInBlock,
    createExpectedPeginBtcEvent,
    createExpectedRejectedPeginEvent,
    createExpectedReleaseRequestRejectedEvent,
} = require('../events-utils');

const assertExpectedPeginBtcEventIsEmitted = async (
    rskTxHelper,
    btcPeginTxHash,
    rskRecipientAddress,
    peginValueInSatoshis,
    expectedPeginProtocolVersion = '0'
) => {
    const recipient1RskAddressChecksumed = rskTxHelper
        .getClient()
        .utils.toChecksumAddress(ensure0x(rskRecipientAddress));
    const expectedEvent = createExpectedPeginBtcEvent(
        recipient1RskAddressChecksumed,
        btcPeginTxHash,
        peginValueInSatoshis,
        expectedPeginProtocolVersion
    );
    const bridge = await getBridge(rskTxHelper.getClient());
    const btcTxHashProcessedHeight = Number(
        await bridge.methods.getBtcTxHashProcessedHeight(btcPeginTxHash).call()
    );
    const peginBtcEvent = await findEventInBlock(
        rskTxHelper,
        expectedEvent.name,
        btcTxHashProcessedHeight
    );
    expect(peginBtcEvent).to.be.deep.equal(expectedEvent);
};

const assertExpectedRejectedPeginEventIsEmitted = async (
    rskTxHelper,
    btcPeginTxHash,
    blockNumberBeforePegin,
    rejectionReason
) => {
    const expectedEvent = createExpectedRejectedPeginEvent(btcPeginTxHash, rejectionReason);
    const currentBlockNumber = await rskTxHelper.getBlockNumber();
    const rejectedPeginEvent = await findEventInBlock(
        rskTxHelper,
        expectedEvent.name,
        blockNumberBeforePegin,
        currentBlockNumber,
        (foundEvent) => foundEvent.arguments.btcTxHash === ensure0x(btcPeginTxHash)
    );
    expect(rejectedPeginEvent).to.be.deep.equal(expectedEvent);
};

const assertNoPeginEventsAreEmitted = async (
    rskTxHelper,
    btcPeginTxHash,
    blockNumberBeforePegin
) => {
    const currentBlockNumber = await rskTxHelper.getBlockNumber();
    for (const { name: eventName } of Object.values(PEGIN_EVENTS)) {
        const found = await findEventInBlock(
            rskTxHelper,
            eventName,
            blockNumberBeforePegin,
            currentBlockNumber,
            (ev) => ev.arguments.btcTxHash === ensure0x(btcPeginTxHash)
        );
        expect(found, `No bridge ${eventName} event should be emitted for btc tx ${btcPeginTxHash}`)
            .to.be.null;
    }
};

const assertExpectedReleaseRequestedEventIsEmitted = async (
    rskTxHelper,
    btcTxHashProcessedHeight,
    peginValueInSatoshis
) => {
    const releaseCreatedEvent = await findEventInBlock(
        rskTxHelper,
        PEGOUT_EVENTS.RELEASE_REQUESTED.name,
        btcTxHashProcessedHeight
    );
    expect(releaseCreatedEvent).to.not.be.null;
    expect(releaseCreatedEvent.signature).to.be.equal(PEGOUT_EVENTS.RELEASE_REQUESTED.signature);
    expect(releaseCreatedEvent.arguments.rskTxHash).to.not.be.undefined;
    expect(releaseCreatedEvent.arguments.btcTxHash).to.not.be.undefined;
    expect(Number(releaseCreatedEvent.arguments.amount)).to.be.equal(peginValueInSatoshis);
};

const assertReleaseRequestReceivedEvent = (
    releaseRequestReceivedEvent,
    rskSenderAddress,
    btcRecipientAddress,
    expectedPegoutValue
) => {
    expect(releaseRequestReceivedEvent.arguments.sender).to.be.equal(rskSenderAddress);
    expect(Number(releaseRequestReceivedEvent.arguments.amount)).to.be.equal(
        Number(expectedPegoutValue)
    );
    expect(releaseRequestReceivedEvent.arguments.btcDestinationAddress).to.be.equal(
        btcRecipientAddress
    );
};

const assertReleaseRequestedEvent = (
    releaseRequestedEvent,
    pegoutCreationRskTransactionHash,
    btcTxHash,
    pegoutValueInSatoshis
) => {
    expect(releaseRequestedEvent.arguments.rskTxHash).to.be.equal(pegoutCreationRskTransactionHash);
    expect(removePrefix0x(releaseRequestedEvent.arguments.btcTxHash)).to.be.equal(btcTxHash);
    expect(Number(releaseRequestedEvent.arguments.amount)).to.be.equal(pegoutValueInSatoshis);
};

const assertBatchPegoutCreatedEvent = (
    batchPegoutCreatedEvent,
    btcTxHash,
    pegoutRequestReceivedTransactionHashes
) => {
    expect(removePrefix0x(batchPegoutCreatedEvent.arguments.btcTxHash)).to.be.equal(btcTxHash);
    const releaseRskTxHashes = batchPegoutCreatedEvent.arguments.releaseRskTxHashes;
    const allPegoutRequestReceivedTxHashesAreInBatch = pegoutRequestReceivedTransactionHashes.every(
        (hash) => releaseRskTxHashes.includes(removePrefix0x(hash))
    );
    expect(allPegoutRequestReceivedTxHashesAreInBatch).to.be.true;
};

const assertPegoutConfirmedEvent = (pegoutConfirmedEvent, btcTxHash, pegoutCreationBlockNumber) => {
    expect(removePrefix0x(pegoutConfirmedEvent.arguments.btcTxHash)).to.be.equal(btcTxHash);
    expect(pegoutConfirmedEvent.arguments.pegoutCreationRskBlockNumber).to.be.equal(
        pegoutCreationBlockNumber
    );
};

const assertAddSignatureEvent = (addSignatureEvent, releaseRequestedEvent) => {
    expect(addSignatureEvent.arguments.releaseRskTxHash).to.be.equal(
        releaseRequestedEvent.arguments.rskTxHash
    );
};

const assertAddSignatureEvents = (addSignatureEvents, releaseRequestedEvent) => {
    for (const addSignatureEvent of addSignatureEvents) {
        assertAddSignatureEvent(addSignatureEvent, releaseRequestedEvent);
    }
};

const assertReleaseBtcEvent = (releaseBtcEvent, releaseRequestedEvent) => {
    expect(releaseBtcEvent.arguments.releaseRskTxHash).to.be.equal(
        releaseRequestedEvent.arguments.rskTxHash
    );
};

const assertSuccessfulPegoutEventsAreEmitted = async (
    rskTxHelper,
    pegoutsEvents,
    pegoutRequestReceivedTransactionHash,
    senderRecipientInfo,
    pegoutValueInSatoshis,
    bridgeStateBeforePegoutCreation,
    bridgeStateAfterPegoutCreation,
    pegoutValueInWeis
) => {
    const pegoutWaitingForConfirmationWhenPegoutWasCreated =
        bridgeStateAfterPegoutCreation.pegoutsWaitingForConfirmations[0];
    const btcTransaction = bitcoinJsLib.Transaction.fromHex(
        pegoutWaitingForConfirmationWhenPegoutWasCreated.btcRawTx
    );
    const rskSenderAddress = rskTxHelper
        .getClient()
        .utils.toChecksumAddress(ensure0x(senderRecipientInfo.rskRecipientRskAddressInfo.address));

    // release_request_received event
    const releaseRequestReceivedEvent = pegoutsEvents[0];

    const expectedPegoutValue = pegoutValueInWeis || satoshisToWeis(pegoutValueInSatoshis);
    assertReleaseRequestReceivedEvent(
        releaseRequestReceivedEvent,
        rskSenderAddress,
        senderRecipientInfo.btcSenderAddressInfo.address,
        expectedPegoutValue
    );

    // release_requested event
    const pegoutCreationRskTransactionHash = ensure0x(
        pegoutWaitingForConfirmationWhenPegoutWasCreated.rskTxHash.padStart(64, '0')
    );
    const releaseRequestedEvent = pegoutsEvents[1];
    assertReleaseRequestedEvent(
        releaseRequestedEvent,
        pegoutCreationRskTransactionHash,
        btcTransaction.getId(),
        pegoutValueInSatoshis
    );

    const pegoutTransactionCreatedEvent = pegoutsEvents[2];
    assertPegoutTransactionCreatedEvent(
        pegoutTransactionCreatedEvent,
        btcTransaction,
        bridgeStateBeforePegoutCreation
    );

    // batch_pegout_created event
    const batchPegoutCreatedEvent = pegoutsEvents[3];
    assertBatchPegoutCreatedEvent(batchPegoutCreatedEvent, btcTransaction.getId(), [
        pegoutRequestReceivedTransactionHash,
    ]);

    // pegout_confirmed event
    const pegoutConfirmedEvent = pegoutsEvents[4];
    assertPegoutConfirmedEvent(
        pegoutConfirmedEvent,
        btcTransaction.getId(),
        pegoutWaitingForConfirmationWhenPegoutWasCreated.pegoutCreationBlockNumber
    );

    const addSignatureEvents = pegoutsEvents.slice(5, -1);
    assertAddSignatureEvents(addSignatureEvents, releaseRequestedEvent);

    // Final event, release_btc
    const releaseBtcEvent = pegoutsEvents.at(-1);
    assertReleaseBtcEvent(releaseBtcEvent, releaseRequestedEvent);
};

const assertExpectedReleaseRequestRejectedEventIsEmitted = async (
    rskTxHelper,
    rskSenderAddress,
    expectedPegoutValue,
    rejectionReason
) => {
    const rskSenderAddressChecksummed = rskTxHelper
        .getClient()
        .utils.toChecksumAddress(ensure0x(rskSenderAddress));
    const expectedEvent = createExpectedReleaseRequestRejectedEvent(
        rskSenderAddressChecksummed,
        expectedPegoutValue,
        rejectionReason
    );
    const releaseRequestRejectedEvent = await findEventInBlock(
        rskTxHelper,
        PEGOUT_EVENTS.RELEASE_REQUEST_REJECTED.name
    );
    expect(releaseRequestRejectedEvent).to.be.deep.equal(expectedEvent);
};

const assertPegoutTransactionCreatedEvent = (
    pegoutTransactionCreatedEvent,
    btcTransaction,
    bridgeStateBeforePegoutRequestsReceived
) => {
    const encodedUtxoOutpointValues = Buffer.from(
        removePrefix0x(pegoutTransactionCreatedEvent.arguments.utxoOutpointValues),
        'hex'
    );
    const outpointValues = decodeOutpointValues(encodedUtxoOutpointValues);
    expect(btcTransaction.getId()).to.be.equal(
        removePrefix0x(pegoutTransactionCreatedEvent.arguments.btcTxHash)
    );
    for (let index = 0; index < btcTransaction.ins.length; index++) {
        const input = btcTransaction.ins[index];
        const inputHash = Buffer.from(input.hash).reverse().toString('hex');
        const bridgeUtxo = bridgeStateBeforePegoutRequestsReceived.activeFederationUtxos.find(
            (utxo) => {
                return utxo.btcTxHash === inputHash && utxo.btcTxOutputIndex === input.index;
            }
        );
        expect(bridgeUtxo).to.not.be.undefined;
        expect(bridgeUtxo.valueInSatoshis).to.be.equal(Number(outpointValues[index]));
    }
};

const assertPegoutTransactionCreatedOutpointValues = async (
    initialBridgeState,
    finalBridgeState,
    svpFundTransaction,
    pegoutTransactionCreatedEvent
) => {
    expect(svpFundTransaction.ins.length > 0).to.be.true;
    expect(svpFundTransaction.ins.length).to.be.at.most(
        initialBridgeState.activeFederationUtxos.length
    );

    const svpFundTxUtxosInInitialBridgeState = [];

    for (const input of svpFundTransaction.ins) {
        const inputTxHash = Buffer.from(input.hash).reverse().toString('hex');
        const inputIndex = input.index;
        const utxoInInitialBridgeState = initialBridgeState.activeFederationUtxos.find(
            (utxo) => utxo.btcTxHash === inputTxHash && utxo.btcTxOutputIndex === inputIndex
        );
        expect(
            utxoInInitialBridgeState,
            `The input tx hash ${inputTxHash} and index ${inputIndex} should be in the initial bridge state.`
        ).to.not.be.undefined;
        svpFundTxUtxosInInitialBridgeState.push(utxoInInitialBridgeState);
        const utxoInFinalBridgeState = finalBridgeState.activeFederationUtxos.find(
            (utxo) => utxo.btcTxHash === inputTxHash && utxo.btcTxOutputIndex === inputIndex
        );
        expect(
            utxoInFinalBridgeState,
            `The input tx hash ${inputTxHash} and index ${inputIndex} should not be in the final bridge state.`
        ).to.be.undefined;
    }

    const encodedUtxoOutpointValues = Buffer.from(
        removePrefix0x(pegoutTransactionCreatedEvent.arguments.utxoOutpointValues),
        'hex'
    );
    const outpointValues = decodeOutpointValues(encodedUtxoOutpointValues);
    expect(outpointValues.length > 0).to.be.true;
    const outpointsValueSum = outpointValues.reduce((acc, value) => acc + Number(value), 0);
    const svpFundTxUtxoInInitialBridgeStateValueSum = svpFundTxUtxosInInitialBridgeState.reduce(
        (acc, utxo) => acc + utxo.valueInSatoshis,
        0
    );
    expect(Number(outpointsValueSum)).to.be.equal(
        svpFundTxUtxoInInitialBridgeStateValueSum,
        'The outpoint value should be the same as the sum of the utxos values used.'
    );
};

const assertNoEventWasEmitted = async (txReceipt) => {
    const isEmpty = Object.keys(txReceipt.events).length === 0;
    expect(isEmpty, 'No event should have been emitted').to.be.true;
};

module.exports = {
    assertExpectedPeginBtcEventIsEmitted,
    assertExpectedRejectedPeginEventIsEmitted,
    assertNoPeginEventsAreEmitted,
    assertExpectedReleaseRequestedEventIsEmitted,
    assertReleaseRequestReceivedEvent,
    assertReleaseRequestedEvent,
    assertBatchPegoutCreatedEvent,
    assertPegoutConfirmedEvent,
    assertAddSignatureEvents,
    assertReleaseBtcEvent,
    assertSuccessfulPegoutEventsAreEmitted,
    assertExpectedReleaseRequestRejectedEventIsEmitted,
    assertPegoutTransactionCreatedEvent,
    assertPegoutTransactionCreatedOutpointValues,
    assertNoEventWasEmitted,
};
