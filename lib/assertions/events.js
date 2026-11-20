const expect = require('chai').expect;
const bitcoinJsLib = require('bitcoinjs-lib');
const { satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { getBridge } = require('../bridge-provider');
const { ensure0x, removePrefix0x } = require('../utils');
const { decodeOutpointValues } = require('../varint');
const { getInputSpentTxHash } = require('../btc-utils');
const { getAddressFromUncompressedPublicKey, uncompressPublicKey } = require('../rsk-utils');
const { getActiveFederationPublicKeys } = require('../federation-utils');
const { KEY_TYPE_BTC, KEY_TYPE_RSK } = require('../constants/federation-constants');
const { PEGIN_EVENTS, PEGOUT_EVENTS, BRIDGE_EVENTS } = require('../constants/events-constants');
const {
    findEventInBlock,
    getEventsInBlockRange,
    createExpectedPeginBtcEvent,
    createExpectedRejectedPeginEvent,
    createExpectedReleaseRequestRejectedEvent,
    findEventInTx,
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

/**
 * Asserts that the release_requested event is emitted in the rsk block with the expected values.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {number} btcTxHashProcessedHeight the rsk block where the release was requested
 * @param {string} rskTxHash
 * @param {string} btcTxHash
 * @param {number} peginValueInSatoshis
 * @returns {Promise<void>}
 */
const assertReleaseRequestedEventIsEmitted = async (
    rskTxHelper,
    btcTxHashProcessedHeight,
    rskTxHash,
    btcTxHash,
    peginValueInSatoshis
) => {
    const releaseRequestedEvent = await findEventInBlock(
        rskTxHelper,
        PEGOUT_EVENTS.RELEASE_REQUESTED.name,
        btcTxHashProcessedHeight
    );
    expect(releaseRequestedEvent).to.not.be.null;
    expect(releaseRequestedEvent.signature).to.be.equal(PEGOUT_EVENTS.RELEASE_REQUESTED.signature);
    assertReleaseRequestedEvent(releaseRequestedEvent, rskTxHash, btcTxHash, peginValueInSatoshis);
};

/**
 * Asserts that the release_requested event of the refund of a rejected pegin is emitted with the values of the refund pegout.
 * The refund pegout is created in the same rsk tx that registers the pegin, spending the pegin outputs.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} btcPeginTxHash
 * @param {number} btcTxHashProcessedHeight the rsk block where the pegin was registered
 * @param {number} peginValueInSatoshis
 * @param {PegoutWaitingConfirmation[]} pegoutsWFC
 * @returns {Promise<void>}
 */
const assertReleaseRequestedEventIsEmittedForRefund = async (
    rskTxHelper,
    btcPeginTxHash,
    btcTxHashProcessedHeight,
    peginValueInSatoshis,
    pegoutsWFC
) => {
    const refundPegoutWFC = pegoutsWFC.find((pegoutWFC) =>
        bitcoinJsLib.Transaction.fromHex(pegoutWFC.btcRawTx).ins.some(
            (input) => getInputSpentTxHash(input) === btcPeginTxHash
        )
    );
    expect(
        refundPegoutWFC,
        'The refund pegout spending the pegin should be waiting for confirmations.'
    ).to.not.be.undefined;

    const refundBtcTransaction = bitcoinJsLib.Transaction.fromHex(refundPegoutWFC.btcRawTx);
    const refundCreationRskTxHash = ensure0x(refundPegoutWFC.rskTxHash);
    await assertReleaseRequestedEventIsEmitted(
        rskTxHelper,
        btcTxHashProcessedHeight,
        refundCreationRskTxHash,
        refundBtcTransaction.getId(),
        peginValueInSatoshis
    );
};

const assertReleaseRequestReceivedEvent = (
    pegoutEvents,
    senderRskAddress,
    recipientBtcAddress,
    expectedPegoutValue
) => {
    const releaseRequestReceivedEventFromSender = pegoutEvents.find(
        (event) =>
            event.signature === PEGOUT_EVENTS.RELEASE_REQUEST_RECEIVED.signature &&
            event.arguments.sender === senderRskAddress
    );
    expect(
        releaseRequestReceivedEventFromSender,
        `A release_request_received event should be emitted for the sender ${senderRskAddress}.`
    ).to.not.be.undefined;
    expect(Number(releaseRequestReceivedEventFromSender.arguments.amount)).to.be.equal(
        Number(expectedPegoutValue)
    );
    expect(releaseRequestReceivedEventFromSender.arguments.btcDestinationAddress).to.be.equal(
        recipientBtcAddress
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
    // The release rsk tx hashes are logged one after the other, 32 bytes each
    const releaseRskTxHashes = removePrefix0x(batchPegoutCreatedEvent.arguments.releaseRskTxHashes)
        .match(/.{1,64}/g)
        .sort();
    const expectedReleaseRskTxHashes = pegoutRequestReceivedTransactionHashes
        .map((hash) => removePrefix0x(hash))
        .sort();
    expect(releaseRskTxHashes).to.be.deep.equal(
        expectedReleaseRskTxHashes,
        'The batch should include exactly the pegout requests received.'
    );
};

const assertPegoutConfirmedEvent = (pegoutConfirmedEvent, btcTxHash, pegoutCreationBlockNumber) => {
    expect(removePrefix0x(pegoutConfirmedEvent.arguments.btcTxHash)).to.be.equal(btcTxHash);
    expect(pegoutConfirmedEvent.arguments.pegoutCreationRskBlockNumber).to.be.equal(
        pegoutCreationBlockNumber
    );
};

/**
 * Asserts that every add_signature event is for the release, and that the release was signed by exactly M of the N members
 * of the active federation, each one signing once. The signing order is not known in advance, so the signers are
 * checked against the federation members.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {BridgeEvent[]} addSignatureEvents
 * @param {BridgeEvent} releaseRequestedEvent
 * @returns {Promise<void>}
 */
const assertAddSignatureEvents = async (rskTxHelper, addSignatureEvents, releaseRequestedEvent) => {
    for (const addSignatureEvent of addSignatureEvents) {
        assertAddSignatureEvent(addSignatureEvent, releaseRequestedEvent);
    }

    const bridge = await getBridge(rskTxHelper.getClient());
    const federationPublicKeys = await getActiveFederationPublicKeys(bridge);
    const federationMembers = getFederationMembers(federationPublicKeys);

    // check the release was signed exactly M times
    const signers = getSigners(addSignatureEvents);
    const requiredSignaturesCount = Math.floor(federationMembers.length / 2) + 1;
    expect(signers.length).to.be.equal(
        requiredSignaturesCount,
        'The release should be signed by M of the N federation members.'
    );

    // check that all M signatures are different
    const signersBtcPublicKeys = signers.map((signer) => signer.federatorBtcPublicKey);
    const differentSignersCount = new Set(signersBtcPublicKeys).size;
    expect(differentSignersCount).to.be.equal(
        signers.length,
        'Each federation member should sign the release only once.'
    );

    // last, check that the rsk address and btc public key of each signer belong to a federation member
    for (const signer of signers) {
        expect(federationMembers).to.deep.include(
            signer,
            'Every add_signature event should be emitted by a member of the federation.'
        );
    }
};

const getFederationMembers = (federationPublicKeys) => {
    return federationPublicKeys.map((federatorPublicKeys) => ({
        federatorRskAddress: ensure0x(
            getAddressFromUncompressedPublicKey(
                uncompressPublicKey(federatorPublicKeys[KEY_TYPE_RSK])
            )
        ).toLowerCase(),
        federatorBtcPublicKey: federatorPublicKeys[KEY_TYPE_BTC].toLowerCase(),
    }));
};

const getSigners = (addSignatureEvents) => {
    return addSignatureEvents.map((addSignatureEvent) => ({
        federatorRskAddress: addSignatureEvent.arguments.federatorRskAddress.toLowerCase(),
        federatorBtcPublicKey: addSignatureEvent.arguments.federatorBtcPublicKey.toLowerCase(),
    }));
};

const assertAddSignatureEvent = (addSignatureEvent, releaseRequestedEvent) => {
    expect(addSignatureEvent.arguments.releaseRskTxHash).to.be.equal(
        releaseRequestedEvent.arguments.rskTxHash
    );
};

const assertReleaseBtcEvent = (releaseBtcEvent, releaseRequestedEvent) => {
    expect(releaseBtcEvent.arguments.releaseRskTxHash).to.be.equal(
        releaseRequestedEvent.arguments.rskTxHash
    );
};

/**
 * Asserts that the release_btc event releases the btc tx requested in the rsk tx it logs as `releaseRskTxHash`,
 * i.e. that rsk tx emitted the release_requested event for the released btc tx.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {BridgeEvent} releaseBtcEvent
 * @returns {Promise<void>}
 */
const assertReleaseBtcEventIsForReleaseRequested = async (rskTxHelper, releaseBtcEvent) => {
    const releaseBtcTransaction = bitcoinJsLib.Transaction.fromHex(
        removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction)
    );
    const releaseRskTxHash = releaseBtcEvent.arguments.releaseRskTxHash;

    const bridge = await getBridge(rskTxHelper.getClient());
    const releaseRequestedEvent = await findEventInTx(
        rskTxHelper,
        releaseRskTxHash,
        PEGOUT_EVENTS.RELEASE_REQUESTED.name,
        bridge.options.jsonInterface
    );
    expect(
        releaseRequestedEvent,
        `The rsk tx ${releaseRskTxHash} should have emitted a release_requested event.`
    ).to.not.be.undefined;
    const releaseRequestedBtcTxHash = removePrefix0x(releaseRequestedEvent.args.btcTxHash);
    expect(releaseRequestedBtcTxHash).to.be.equal(
        releaseBtcTransaction.getId(),
        `The rsk tx ${releaseRskTxHash} should have requested the release of the btc tx ${releaseBtcTransaction.getId()}.`
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

    // release_request_received event, it should be the first one
    expect(pegoutsEvents[0].signature).to.be.equal(
        PEGOUT_EVENTS.RELEASE_REQUEST_RECEIVED.signature,
        'The release_request_received event should be the first pegout event.'
    );
    const expectedPegoutValue = pegoutValueInWeis || satoshisToWeis(pegoutValueInSatoshis);
    assertReleaseRequestReceivedEvent(
        pegoutsEvents,
        rskSenderAddress,
        senderRecipientInfo.btcSenderAddressInfo.address,
        expectedPegoutValue
    );

    // release_requested event
    const pegoutCreationRskTransactionHash = ensure0x(
        pegoutWaitingForConfirmationWhenPegoutWasCreated.rskTxHash
    );
    const releaseRequestedEvent = pegoutsEvents[1];
    assertReleaseRequestedEvent(
        releaseRequestedEvent,
        pegoutCreationRskTransactionHash,
        btcTransaction.getId(),
        pegoutValueInSatoshis
    );

    const pegoutTransactionCreatedEvent = pegoutsEvents[2];
    assertPegoutTransactionCreatedEventIsEmitted(
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
    await assertAddSignatureEvents(rskTxHelper, addSignatureEvents, releaseRequestedEvent);

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

const assertPegoutTransactionCreatedEventIsEmitted = (
    pegoutTransactionCreatedEvent,
    btcTransaction,
    bridgeStateBeforePegoutCreated
) => {
    const encodedUtxoOutpointValues = Buffer.from(
        removePrefix0x(pegoutTransactionCreatedEvent.arguments.utxoOutpointValues),
        'hex'
    );
    const outpointValues = decodeOutpointValues(encodedUtxoOutpointValues);
    expect(outpointValues.length).to.be.equal(
        btcTransaction.ins.length,
        'There should be one outpoint value per input of the transaction.'
    );
    expect(btcTransaction.getId()).to.be.equal(
        removePrefix0x(pegoutTransactionCreatedEvent.arguments.btcTxHash)
    );
    for (let index = 0; index < btcTransaction.ins.length; index++) {
        const input = btcTransaction.ins[index];
        const inputHash = getInputSpentTxHash(input);
        const bridgeUtxo = bridgeStateBeforePegoutCreated.activeFederationUtxos.find((utxo) => {
            return utxo.btcTxHash === inputHash && utxo.btcTxOutputIndex === input.index;
        });
        expect(bridgeUtxo).to.not.be.undefined;
        expect(bridgeUtxo.valueInSatoshis).to.be.equal(Number(outpointValues[index]));
    }
};

const assertNoEventWasEmitted = async (txReceipt) => {
    const isEmpty = Object.keys(txReceipt.events).length === 0;
    expect(isEmpty, 'No event should have been emitted').to.be.true;
};

/**
 * Asserts that, in the rsk block where `btcTxHash` was registered, the Bridge emitted exactly one `utxos_registered` event
 * for the outputs of that transaction paying `federationAddress`, with their values and indexes in output order.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {string} btcTxHash the hash of the btc transaction whose utxos were registered
 * @param {string} federationAddress the address of the federation the registered utxos belong to
 * @returns {Promise<void>}
 */
const assertUtxosRegisteredEventIsEmitted = async (
    rskTxHelper,
    btcTxHelper,
    btcTxHash,
    federationAddress
) => {
    const bridge = await getBridge(rskTxHelper.getClient());
    const registrationBlockNumber = Number(
        await bridge.methods.getBtcTxHashProcessedHeight(btcTxHash).call()
    );

    const btcTransaction = await btcTxHelper.getTransaction(btcTxHash);
    const outputsToTheFederation = btcTransaction.outs
        .map((output, index) => ({ output, index }))
        .filter(({ output }) => btcTxHelper.getOutputAddress(output.script) === federationAddress);

    // A single registration emits one event per federation, so every event in the block is checked.
    const eventsInRegistrationBlock = await getEventsInBlockRange(
        rskTxHelper,
        registrationBlockNumber
    );
    const utxosRegisteredEvents = eventsInRegistrationBlock.filter(
        (event) =>
            event.name === BRIDGE_EVENTS.UTXOS_REGISTERED.name &&
            removePrefix0x(event.arguments.btcTxHash) === btcTxHash &&
            event.arguments.federationBtcAddress === federationAddress
    );
    expect(utxosRegisteredEvents.length).to.be.equal(
        1,
        `The utxos_registered event for ${btcTxHash} and ${federationAddress} should be emitted once.`
    );

    const [utxosRegisteredEvent] = utxosRegisteredEvents;
    expect(utxosRegisteredEvent.signature).to.be.equal(BRIDGE_EVENTS.UTXOS_REGISTERED.signature);

    const outputValues = decodeOutpointValues(
        Buffer.from(removePrefix0x(utxosRegisteredEvent.arguments.outputValues), 'hex')
    ).map(Number);
    const expectedOutputValues = outputsToTheFederation.map(({ output }) => Number(output.value));
    expect(outputValues).to.be.deep.equal(
        expectedOutputValues,
        'The event output values should be the values of the outputs paying the federation.'
    );

    const outputIndexes = decodeOutpointValues(
        Buffer.from(removePrefix0x(utxosRegisteredEvent.arguments.outputIndexes), 'hex')
    ).map(Number);
    const expectedOutputIndexes = outputsToTheFederation.map(({ index }) => index);
    expect(outputIndexes).to.be.deep.equal(
        expectedOutputIndexes,
        'The event output indexes should be the indexes of the outputs paying the federation.'
    );
};

module.exports = {
    assertExpectedPeginBtcEventIsEmitted,
    assertExpectedRejectedPeginEventIsEmitted,
    assertNoPeginEventsAreEmitted,
    assertReleaseRequestedEventIsEmitted,
    assertReleaseRequestedEventIsEmittedForRefund,
    assertReleaseRequestReceivedEvent,
    assertReleaseRequestedEvent,
    assertBatchPegoutCreatedEvent,
    assertPegoutConfirmedEvent,
    assertAddSignatureEvents,
    assertReleaseBtcEvent,
    assertReleaseBtcEventIsForReleaseRequested,
    assertSuccessfulPegoutEventsAreEmitted,
    assertExpectedReleaseRequestRejectedEventIsEmitted,
    assertPegoutTransactionCreatedEventIsEmitted,
    assertNoEventWasEmitted,
    assertUtxosRegisteredEventIsEmitted,
};
