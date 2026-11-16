const BridgeTransactionParser = require('@rsksmart/bridge-transaction-parser');
const { getEthersProvider } = require('./rsk-utils');
const { ensure0x } = require('./utils');
const { PEGIN_EVENTS } = require('./constants/pegin-constants');
const { PEGOUT_EVENTS } = require('./constants/pegout-constants');

/**
 * Gets the block range from `fromBlockNumber` to `toBlockNumber`.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {number} fromBlockNumber optional.
 * @param {number} toBlockNumber optional.
 * @returns {Promise<{startBlock: number, endBlock: number}>}
 */
const getValidBlockRange = async (rskTxHelper, fromBlockNumber, toBlockNumber) => {
    fromBlockNumber ||= await rskTxHelper.getBlockNumber();
    toBlockNumber ||= fromBlockNumber;

    if (fromBlockNumber > toBlockNumber) {
        throw new Error(
            `fromBlockNumber: ${fromBlockNumber} is greater than toBlockNumber: ${toBlockNumber}`
        );
    }

    return { startBlock: fromBlockNumber, endBlock: toBlockNumber };
};

const findBridgeTransactionsInThisBlock = async (rskTxHelper, blockHashOrBlockNumber) => {
    const bridgeTxParser = new BridgeTransactionParser(getEthersProvider(rskTxHelper));
    return await bridgeTxParser.getBridgeTransactionsInThisBlock(blockHashOrBlockNumber);
};

/**
 *
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} eventName
 * @param {number} fromBlockNumber optional. If not provided, search starts at the latest block number from `rskTxHelper.getBlockNumber()`.
 * @param {number} toBlockNumber optional. If not provided, equals `fromBlockNumber`. Must be greater than or equal to `fromBlockNumber` when both are set.
 * @param {(BridgeEvent) => Promise<boolean>} check, check callback, optional. If provided, calls it with the event found by the `eventName`
 *  and expect to receive a boolean value. If `check` returns false, it will continue searching for the event, otherwise it will return the event found.
 * @returns {Promise<BridgeEvent>} event
 */
const findEventInBlock = async (rskTxHelper, eventName, fromBlockNumber, toBlockNumber, check) => {
    if (typeof eventName !== 'string') {
        throw new TypeError(
            '`eventName` parameter must be a string. It is of type: ' + typeof eventName
        );
    }
    const { startBlock, endBlock } = await getValidBlockRange(
        rskTxHelper,
        fromBlockNumber,
        toBlockNumber
    );

    for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
        const bridgeTransactions = await findBridgeTransactionsInThisBlock(
            rskTxHelper,
            blockNumber
        );
        for (let i = 0; i < bridgeTransactions.length; i++) {
            const tx = bridgeTransactions[i];
            const event = tx.events.find((event) => event.name === eventName);
            if (!event) continue;
            if (check && !(await check(event, tx))) continue;
            return event;
        }
    }
    return null;
};

/**
 * Gets all the bridge events in the block range from `fromBlockNumber` to `toBlockNumber`.
 * If no `fromBlockNumber` is provided, it will start from the latest block number up to the `toBlockNumber`.
 * If no `toBlockNumber` is provided, it will be equal to `fromBlockNumber`.
 * @param {RskTransactionHelper} rskTxHelper to make transactions to the rsk network
 * @param {number} fromBlockNumber optional. Defaults to the latest block number.
 * @param {number} toBlockNumber optional. Defaults to the `fromBlockNumber`.
 * @returns {Promise<BridgeEvent[]>} events
 */
const getEventsInBlockRange = async (rskTxHelper, fromBlockNumber, toBlockNumber) => {
    const { startBlock, endBlock } = await getValidBlockRange(
        rskTxHelper,
        fromBlockNumber,
        toBlockNumber
    );
    const events = [];

    for (let blockNumber = startBlock; blockNumber <= endBlock; blockNumber++) {
        const bridgeTransactions = await findBridgeTransactionsInThisBlock(
            rskTxHelper,
            blockNumber
        );
        for (const tx of bridgeTransactions) {
            events.push(...tx.events);
        }
    }

    return events;
};

/**
 * Gets all the pegout events in the block range from `fromBlockHashOrBlockNumber` to `toBlockHashOrBlockNumber`.
 * @param {RskTransactionHelper} rskTxHelper to make transactions to the rsk network
 * @param {number} fromBlockHashOrBlockNumber
 * @param {number} toBlockHashOrBlockNumber
 * @returns {Promise<BridgeEvent[]>} a list of pegout events
 */
const getPegoutEventsInBlockRange = async (
    rskTxHelper,
    fromBlockHashOrBlockNumber,
    toBlockHashOrBlockNumber
) => {
    const eventsInRange = await getEventsInBlockRange(
        rskTxHelper,
        fromBlockHashOrBlockNumber,
        toBlockHashOrBlockNumber
    );
    const pegoutsEventsDefinitions = Object.values(PEGOUT_EVENTS);
    return eventsInRange.filter((event) => {
        return pegoutsEventsDefinitions.find(
            (pegoutEvent) => pegoutEvent.signature === event.signature
        );
    });
};

const buildEventSignatureMap = (rskClient, contractAbi) => {
    return contractAbi
        .flat()
        .filter((element) => element.type === 'event')
        .reduce((acc, element) => {
            const signature = rskClient.eth.abi.encodeEventSignature(element);
            acc[signature] = element;
            return acc;
        }, {});
};

const decodeLog = (rskClient, log, abiElement) => {
    const decodedLog = rskClient.eth.abi.decodeLog(
        abiElement.inputs,
        log.data,
        log.topics.slice(1)
    );

    const args = {};
    for (let input of abiElement.inputs) {
        args[input.name] = decodedLog[input.name];
    }

    return {
        name: abiElement.name,
        signature: log.topics[0],
        args: args,
    };
};

const decodeLogs = (rskClient, txReceipt, contractAbi) => {
    const eventSignatureMap = buildEventSignatureMap(rskClient, contractAbi);
    const events = [];
    for (let log of txReceipt.logs) {
        if (log.topics.length === 0) {
            continue;
        }

        const eventSignature = log.topics[0];
        const abiElement = eventSignatureMap[eventSignature];
        if (!abiElement) {
            continue;
        }
        const event = decodeLog(rskClient, log, abiElement);
        events.push(event);
    }
    return events;
};

const findEventInTx = async (rskTxHelper, txHash, eventName, contractAbi = []) => {
    const rskClient = rskTxHelper.getClient();
    // Fetch the transaction receipt to get all the logs (including the ones from internal txs)
    const txReceipt = await rskTxHelper.getTxReceipt(txHash);
    const events = decodeLogs(rskClient, txReceipt, contractAbi);
    return events.find((event) => event.name === eventName);
};

/**
 * Creates a pegin_btc event with the specified parameters.
 * @param {string} rskRecipientRskAddress the rsk address that receives the funds expected to be in the event.
 * @param {string} btcPeginTxHash the pegin btc tx hash expected to be in the event.
 * @param {number} peginValueInSatoshis the pegin value in satoshis expected to be in the event.
 * @param {string} protocolVersion the pegin protocol version expected to be in the event. Defaults to '0'.
 * @returns {BridgeEvent}
 */
const createExpectedPeginBtcEvent = (
    rskRecipientRskAddress,
    btcPeginTxHash,
    peginValueInSatoshis,
    protocolVersion = '0'
) => {
    const expectedEvent = {
        ...PEGIN_EVENTS.PEGIN_BTC,
        arguments: {
            receiver: ensure0x(rskRecipientRskAddress),
            btcTxHash: ensure0x(btcPeginTxHash),
            amount: `${peginValueInSatoshis}`,
            protocolVersion,
        },
    };
    return expectedEvent;
};

/**
 * Creates a rejected_pegin event with the specified parameters.
 * @param {string} btcPeginTxHash the pegin btc tx hash expected to be in the event.
 * @param {string} rejectionReason the pegin rejection reason.
 * @returns {BridgeEvent}
 */
const createExpectedRejectedPeginEvent = (btcPeginTxHash, rejectionReason) => {
    const expectedEvent = {
        ...PEGIN_EVENTS.REJECTED_PEGIN,
        arguments: {
            btcTxHash: ensure0x(btcPeginTxHash),
            reason: rejectionReason,
        },
    };
    return expectedEvent;
};

const createExpectedReleaseRequestRejectedEvent = (
    rskSenderAddress,
    amountInSatoshis,
    rejectionReason
) => {
    const expectedEvent = {
        ...PEGOUT_EVENTS.RELEASE_REQUEST_REJECTED,
        arguments: {
            sender: rskSenderAddress,
            amount: amountInSatoshis.toString(),
            reason: rejectionReason,
        },
    };
    return expectedEvent;
};

const getReleaseRequestRejectedEventFromContractCallTxReceipt = (
    rskTxHelper,
    contractCallTxReceipt
) => {
    const bridgeTxParser = new BridgeTransactionParser(getEthersProvider(rskTxHelper));
    const logData = contractCallTxReceipt.events['0'].raw;
    const releaseRequestRejectedAbiElement = bridgeTxParser.bridge.interface.getEvent(
        logData.topics[0]
    );
    const releaseRequestRejectedEvent = bridgeTxParser.decodeLog(
        logData,
        releaseRequestRejectedAbiElement
    );
    return {
        ...releaseRequestRejectedEvent,
        arguments: {
            sender: releaseRequestRejectedEvent.arguments.sender,
            amount: releaseRequestRejectedEvent.arguments.amount.toString(),
            reason: releaseRequestRejectedEvent.arguments.reason.toString(),
        },
    };
};

const findReleaseBtcEventsInBlockRange = async (rskTxHelper, fromBlockNumber, toBlockNumber) => {
    const pegoutEvents = await getPegoutEventsInBlockRange(
        rskTxHelper,
        fromBlockNumber,
        toBlockNumber
    );
    return pegoutEvents.filter((event) => event.name === PEGOUT_EVENTS.RELEASE_BTC.name);
};

module.exports = {
    findEventInBlock,
    getPegoutEventsInBlockRange,
    findReleaseBtcEventsInBlockRange,
    decodeLogs,
    findEventInTx,
    createExpectedPeginBtcEvent,
    createExpectedRejectedPeginEvent,
    createExpectedReleaseRequestRejectedEvent,
    getReleaseRequestRejectedEventFromContractCallTxReceipt,
};
