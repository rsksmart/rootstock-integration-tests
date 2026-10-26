/**
 * Drives a federation change from end to end, with no assertions of its own.
 *
 * `lib/tests/change-federation.js` already walks this path, but it is a test: it asserts at every
 * step, exercises authorization failures, pegins and flyover, and is written for one change from a
 * named federation config to another. A scenario that does seventeen changes in a row needs the
 * mechanics without any of that, told what size to grow to and left to report back what happened.
 *
 * The happy path it follows is the one documented for regtest:
 *   create pending federation -> add members -> commit -> SVP -> activation -> migration -> retire
 *
 * Rather than hardcoding the exact sequence of mine and updateCollections calls for each stage,
 * the stages below share one pump: call updateCollections, give confirmations to whatever is
 * waiting for them on either chain, and repeat until the stage's exit condition holds or the
 * cycle budget runs out. That survives the small timing differences between runs, which a fixed
 * sequence does not.
 */
const rskUtils = require('../../lib/rsk-utils');
const { getBridge } = require('../../lib/bridge-provider');
const { getRskTransactionHelpers } = require('../../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../../lib/btc-client-provider');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const { getBitcoinTransactionsInMempool } = require('../../lib/btc-utils');
const {
    getProposedFederationInfo,
    getActiveFederationInfo,
} = require('../../lib/federation-utils');
const { BTC_TO_RSK_MINIMUM_CONFIRMATIONS } = require('../../lib/2wp-utils');
const {
    REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS,
    FEDERATION_ACTIVATION_AGE,
    FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_BEGIN,
    FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END,
    VALIDATION_PERIOD_DURATION_IN_BLOCKS,
    FEDERATION_EVENTS,
} = require('../../lib/constants/federation-constants');
const { ethToWeis, satoshisToBtc } = require('@rsksmart/btc-eth-unit-converter');
const { getLogger } = require('../../logger');
const { getFederators, getRequiredSignaturesCount } = require('./federator-keys');
const {
    startFederatorNode,
    getStartedNodes,
    settleNetwork,
    fundFederatorNodes,
    topUpActiveFederationIfNeeded,
    getActiveFederationBalanceInSatoshis,
} = require('./scenario-bootstrap');

const logger = getLogger();

// Majority of the three regtest federation change authorizers.
const REQUIRED_AUTHORIZER_VOTES = 2;

// A bridge pump cycle is one updateCollections plus whatever confirmations are owed, so a budget
// of this many is generous for any single stage. Running out means the stage is stuck, not slow.
const MAX_PUMP_CYCLES = 80;

const NO_FEDERATION_SIZE = -1;

let authorizerAddresses = null;

const log = (message) => logger.info(`[federation-change] ${message}`);

/**
 * Imports and funds the regtest federation change authorizers.
 *
 * Called before every change rather than once per run: an account the node unlocked earlier
 * lapses after a while, and a walk up to 20 members runs for hours. The first attempt cached
 * these and every change past the thirteenth died with
 * `Could not find account for address: 0x5252403b...`.
 * @param {object} rskTxHelper
 * @returns {Promise<Array<string>>} the authorizer addresses
 */
const setUpAuthorizers = async (rskTxHelper) => {
    const isFirstTime = authorizerAddresses === null;

    authorizerAddresses = await rskUtils.importAccounts(
        rskTxHelper,
        REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS
    );

    if (isFirstTime) {
        for (const authorizerAddress of authorizerAddresses) {
            await rskUtils.sendFromCow(rskTxHelper, authorizerAddress, ethToWeis(0.1));
        }
        log(`federation change authorizers ready: ${authorizerAddresses.length}`);
    }

    return authorizerAddresses;
};

/**
 * Sends the same bridge call from enough authorizers for the vote to pass.
 * @param {object} rskTxHelper
 * @param {object} method a bridge contract method
 * @returns {Promise<object>} the receipt of the vote that carried it
 */
const voteWithAuthorizers = async (rskTxHelper, method) => {
    let lastReceipt;
    for (let voteIndex = 0; voteIndex < REQUIRED_AUTHORIZER_VOTES; voteIndex++) {
        lastReceipt = await rskUtils.sendTransaction(
            rskTxHelper,
            method,
            authorizerAddresses[voteIndex]
        );
    }
    return lastReceipt;
};

/**
 * Calls updateCollections and hands out confirmations on both chains until `isDone` says the
 * stage is over.
 * @param {object} context
 * @param {string} stageName for the logs and the error message
 * @param {function(): Promise<boolean>} isDone
 * @param {number} [maxCycles]
 * @returns {Promise<boolean>} whether the stage finished within its budget
 */
const pumpBridgeUntil = async (context, stageName, isDone, maxCycles = MAX_PUMP_CYCLES) => {
    const { rskTxHelper, rskTxHelpers, btcTxHelper } = context;

    if (await isDone()) {
        return true;
    }

    for (let cycle = 1; cycle <= maxCycles; cycle++) {
        await rskUtils.waitAndUpdateBridge(rskTxHelper);

        const bridgeState = await getBridgeState(rskUtils.getRskHost(rskTxHelper));
        const bitcoinMempool = await getBitcoinTransactionsInMempool(btcTxHelper);

        log(
            `${stageName} cycle ${cycle}: rsk block ${await rskTxHelper.getBlockNumber()}, ` +
                `pegouts waiting for confirmations ${bridgeState.pegoutsWaitingForConfirmations.length}, ` +
                `waiting for signatures ${bridgeState.pegoutsWaitingForSignatures.length}, ` +
                `active federation utxos ${bridgeState.activeFederationUtxos.length}, ` +
                `bitcoin mempool ${bitcoinMempool.length}`
        );

        if (bridgeState.pegoutsWaitingForConfirmations.length > 0) {
            await rskUtils.mineAndSync(rskTxHelpers, BTC_TO_RSK_MINIMUM_CONFIRMATIONS);
        }

        if (bitcoinMempool.length > 0) {
            await btcTxHelper.mine(BTC_TO_RSK_MINIMUM_CONFIRMATIONS);
        }

        if (await isDone()) {
            log(`${stageName} finished after ${cycle} cycle(s)`);
            return true;
        }
    }

    log(`${stageName} did not finish within ${maxCycles} cycles`);
    return false;
};

/**
 * Starts whatever federator nodes a federation of the given size needs, and no more. Half plus
 * one of the members have to be able to sign; the rest only need their public keys registered.
 * @param {number} federationSize
 * @returns {Promise<Array<object>>} the nodes started by this call
 */
const ensureEnoughNodesRunning = async (federationSize) => {
    const config = Runners.config;
    const requiredNodesCount = getRequiredSignaturesCount(federationSize);
    const runningNodesCount = getStartedNodes().length;
    const newlyStarted = [];

    for (let nodeIndex = runningNodesCount; nodeIndex < requiredNodesCount; nodeIndex++) {
        newlyStarted.push(await startFederatorNode(config.nodePool[nodeIndex]));
    }

    if (newlyStarted.length > 0) {
        log(
            `started ${newlyStarted.length} more node(s) for a ${federationSize} member federation, ${requiredNodesCount} running now`
        );

        // Settle before funding, not after. A node joining this late has the whole chain to catch
        // up on, and funding sends a transaction, which waits for every node to be in sync using
        // rskUtils.waitForSync and its sixteen minute per node budget. Letting the bounded settle
        // absorb the catch-up first took eight minutes off each node addition, and leaves a
        // failure naming the node that lagged instead of a silent wait.
        await settleNetwork();

        // Without an rsk balance a new node cannot pay for its own `addSignature` calls, so it
        // would never sign and every pegout from here on would stall.
        await fundFederatorNodes(newlyStarted);
    }

    return newlyStarted;
};

/**
 * Creates the pending federation, adds the first `federationSize` members of the pool and commits
 * it.
 * @param {object} context
 * @param {number} federationSize
 * @returns {Promise<{activationHeight: number, commitBlockNumber: number}>}
 */
const proposeFederation = async (context, federationSize) => {
    const { rskTxHelper, bridge } = context;

    await voteWithAuthorizers(rskTxHelper, bridge.methods.createFederation());

    for (const federator of getFederators(federationSize)) {
        const publicKey = `0x${federator.publicKey}`;
        await voteWithAuthorizers(
            rskTxHelper,
            bridge.methods.addFederatorPublicKeyMultikey(publicKey, publicKey, publicKey)
        );
    }

    const pendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());
    if (pendingFederationSize !== federationSize) {
        throw new Error(
            `The pending federation has ${pendingFederationSize} members, expected ${federationSize}`
        );
    }

    const pendingFederationHash = await bridge.methods.getPendingFederationHash().call();
    const commitReceipt = await voteWithAuthorizers(
        rskTxHelper,
        bridge.methods.commitFederation(pendingFederationHash)
    );
    const commitBlockNumber = commitReceipt.blockNumber;

    // Read back the address the Bridge derived for the proposed federation. It is the only place
    // the Bridge's own redeem script encoding is observable from here, and comparing it against
    // the address the javascript parser derives for the same keys is what turns "this change did
    // not go through" into "the Bridge built a different script than it should have".
    const proposedFederationInfo = await getProposedFederationInfo(bridge);

    log(
        `committed a ${federationSize} member federation at block ${commitBlockNumber}, proposed address ${proposedFederationInfo.address}`
    );

    return {
        commitBlockNumber,
        activationHeight: commitBlockNumber + FEDERATION_ACTIVATION_AGE,
        proposedFederationAddress: proposedFederationInfo.address,
    };
};

/**
 * Drives the SVP process to its end: the fund transaction, the spend transaction, and the
 * proposed federation leaving storage once both are registered back in the Bridge.
 * @param {object} context
 * @param {number} commitBlockNumber
 * @returns {Promise<{completed: boolean, failureEvent: object|null}>}
 */
const runSvp = async (context, commitBlockNumber) => {
    const { rskTxHelper, rskTxHelpers, bridge } = context;

    const proposedFederationIsGone = async () => {
        const proposedFederationInfo = await getProposedFederationInfo(bridge);
        return proposedFederationInfo.size === NO_FEDERATION_SIZE;
    };

    const completed = await pumpBridgeUntil(context, 'svp', proposedFederationIsGone);
    if (completed) {
        return { completed: true, failureEvent: null };
    }

    // The SVP did not go through. The Bridge gives up on its own once the validation period is
    // over, so mine past it and look for the event that says so, which is what tells a stuck
    // scenario apart from a broken one.
    const validationDeadline = commitBlockNumber + VALIDATION_PERIOD_DURATION_IN_BLOCKS;
    const currentBlockNumber = await rskTxHelper.getBlockNumber();
    if (currentBlockNumber <= validationDeadline) {
        await rskUtils.mineAndSync(rskTxHelpers, validationDeadline - currentBlockNumber + 1);
    }
    await rskUtils.waitAndUpdateBridge(rskTxHelper);

    let failureEvent = null;
    let failureEventLookupError = null;
    try {
        failureEvent = await rskUtils.findEventInBlock(
            rskTxHelper,
            FEDERATION_EVENTS.COMMIT_FEDERATION_FAILED.name,
            commitBlockNumber,
            await rskTxHelper.getBlockNumber()
        );
    } catch (error) {
        // Looking the event up is diagnostics, not the result. Losing it should not turn a
        // federation change that simply did not activate into a crash.
        failureEventLookupError = error;
        log(
            `could not look up ${FEDERATION_EVENTS.COMMIT_FEDERATION_FAILED.name}: ${error.message}`
        );
    }

    return { completed: false, failureEvent: failureEvent || null, failureEventLookupError };
};

/**
 * Mines up to the activation height, where the proposed federation becomes the active one and the
 * previous one starts retiring.
 * @param {object} context
 * @param {number} activationHeight
 */
const activateFederation = async (context, activationHeight) => {
    const { rskTxHelper, rskTxHelpers } = context;
    const currentBlockNumber = await rskTxHelper.getBlockNumber();

    if (currentBlockNumber <= activationHeight) {
        await rskUtils.mineAndSync(rskTxHelpers, activationHeight - currentBlockNumber + 1);
    }
    log(`federation activated at block ${activationHeight}`);
};

/**
 * Opens the migration window, moves the funds across and then retires the old federation.
 * @param {object} context
 * @returns {Promise<boolean>} whether the old federation was retired
 */
const migrateAndRetire = async (context) => {
    const { rskTxHelper, rskTxHelpers, bridge } = context;

    await rskUtils.mineAndSync(rskTxHelpers, FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_BEGIN + 1);

    const migrationIsDone = async () => {
        const bridgeState = await getBridgeState(rskUtils.getRskHost(rskTxHelper));
        return (
            bridgeState.pegoutsWaitingForConfirmations.length === 0 &&
            bridgeState.pegoutsWaitingForSignatures.length === 0 &&
            bridgeState.activeFederationUtxos.length > 0
        );
    };
    await pumpBridgeUntil(context, 'migration', migrationIsDone);

    await rskUtils.mineAndSync(rskTxHelpers, FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END + 1);

    const retiringFederationIsGone = async () =>
        Number(await bridge.methods.getRetiringFederationSize().call()) === NO_FEDERATION_SIZE;

    return await pumpBridgeUntil(context, 'retirement', retiringFederationIsGone);
};

/**
 * Builds the handles the stages share.
 * @returns {Promise<object>}
 */
const createContext = async () => {
    const rskTxHelpers = getRskTransactionHelpers();
    const rskTxHelper = rskTxHelpers[0];
    return {
        rskTxHelpers,
        rskTxHelper,
        btcTxHelper: getBtcClient(),
        bridge: await getBridge(rskTxHelper.getClient()),
    };
};

/**
 * Grows the active federation to `targetSize` members and reports what happened.
 *
 * It never throws because a federation change did not go through: a change that fails is a result
 * this scenario is interested in, so the caller gets it back and decides what it means.
 * @param {number} targetSize
 * @returns {Promise<{targetSize: number, activated: boolean, activeFederationSize: number,
 *   activeFederationAddress: string, failureEvent: object|null, retired: boolean}>}
 */
const changeFederationTo = async (targetSize) => {
    const context = await createContext();
    const { bridge } = context;

    await setUpAuthorizers(context.rskTxHelper);
    await ensureEnoughNodesRunning(targetSize);

    // The SVP fund transaction costs real satoshis and a migration consolidates whatever is left
    // into one utxo, so the federation thins out over a long walk. Top it up before it cannot pay.
    await topUpActiveFederationIfNeeded();

    const balanceInSatoshis = await getActiveFederationBalanceInSatoshis();
    if (balanceInSatoshis === 0) {
        throw new Error(
            `The active federation holds nothing, so the change to ${targetSize} members cannot run its SVP`
        );
    }

    log(
        `changing the federation to ${targetSize} members, with ${satoshisToBtc(balanceInSatoshis)} btc available`
    );

    const { commitBlockNumber, activationHeight, proposedFederationAddress } =
        await proposeFederation(context, targetSize);
    const svpResult = await runSvp(context, commitBlockNumber);

    if (!svpResult.completed) {
        const activeFederationInfo = await getActiveFederationInfo(bridge);
        log(
            `the ${targetSize} member federation never activated, the active one still has ${activeFederationInfo.size} members`
        );
        return {
            targetSize,
            activated: false,
            retired: false,
            proposedFederationAddress,
            failureEvent: svpResult.failureEvent,
            failureEventLookupError: svpResult.failureEventLookupError,
            activeFederationSize: activeFederationInfo.size,
            activeFederationAddress: activeFederationInfo.address,
        };
    }

    await activateFederation(context, activationHeight);
    const retired = await migrateAndRetire(context);

    const activeFederationInfo = await getActiveFederationInfo(bridge);
    log(
        `the active federation now has ${activeFederationInfo.size} members at ${activeFederationInfo.address}`
    );

    return {
        targetSize,
        activated: true,
        retired,
        proposedFederationAddress,
        failureEvent: null,
        activeFederationSize: activeFederationInfo.size,
        activeFederationAddress: activeFederationInfo.address,
    };
};

module.exports = {
    changeFederationTo,
    ensureEnoughNodesRunning,
    setUpAuthorizers,
    createContext,
};
