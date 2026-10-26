/**
 * Root level setup and teardown for a manual scenario that needs a running network.
 *
 * A scenario names this file in its manifest's `bootstrapFile`, and the runner hands it to mocha
 * with `--file`, so the hooks below run once around the whole scenario. It does the same job
 * `test.js` does for the regular suite - start bitcoind, start the federator nodes, tear it all
 * down afterwards - with one difference that matters here: it can start more federator nodes
 * later, while the scenario is running, which is what lets a federation grow without restarting
 * anything.
 */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const colors = require('colors/safe');
const LineWrapper = require('stream-line-wrapper');
const BitcoinRunner = require('../../lib/bitcoin-runner').Runner;
const federateStarter = require('../../lib/federate-starter');
const btcNetworks = require('@rsksmart/btc-transaction-helper').networks;
const { getBtcClient } = require('../../lib/btc-client-provider');
const { getRskTransactionHelpers } = require('../../lib/rsk-tx-helper-provider');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const { satoshisToBtc, btcToSatoshis } = require('@rsksmart/btc-eth-unit-converter');
const {
    createSenderRecipientInfo,
    sendPeginToActiveFederation,
    ensurePeginIsRegistered,
} = require('../../lib/2wp-utils');
const rskUtils = require('../../lib/rsk-utils');
const { fundNewFederators } = require('../../lib/federation-utils');
const { wait } = require('../../lib/utils');
const { getLogger } = require('../../logger');

const logger = getLogger();

const BTC_HOST = '127.0.0.1';
const INITIAL_BTC_BLOCKS = 400;

// A handful of rsk blocks mined once the initial nodes are up, to get the network moving and,
// more to the point, to prove the nodes actually relay blocks to each other before a scenario
// starts depending on it. A node that is not syncing has to be caught here, in seconds, not deep
// inside a federation change where the symptom is a connection timeout an hour later.
const INITIAL_RSK_BLOCKS = 15;

const SYNC_POLL_INTERVAL_IN_MILLISECONDS = 1000;
const NODE_READY_TIMEOUT_IN_MILLISECONDS = 120000;
const PEER_CONNECTION_TIMEOUT_IN_MILLISECONDS = 30000;
const PORT_CHECK_TIMEOUT_IN_MILLISECONDS = 500;
const SCENARIO_LOCK_FILE = 'scenario.lock';
const SETTLE_SYNC_TIMEOUT_IN_MILLISECONDS = 45000;
const SETTLE_ATTEMPTS = 5;

// The Bridge only creates the SVP fund transaction of a federation change if the active federation
// can pay for it, and every change afterwards also needs something to migrate.
//
// The amount matters more than the count. Each SVP fund transaction moves 500000 satoshis and
// pays fees on top, and a migration consolidates everything into a single utxo, so a scenario
// that does seventeen changes in a row drains a thin federation long before the end. The first
// attempt funded it with ten pegins of the 0.005 btc minimum and ran out around the ninth change,
// with the Bridge logging `Not enough BTC in the wallet to complete sending 500000 in svp fund
// transaction`.
const INITIAL_PEGINS_COUNT = 10;
const PEGIN_VALUE_IN_BTC = 0.1;

// Below this, a scenario tops the federation up rather than discovering mid change that it
// cannot pay for the next SVP.
const MINIMUM_FEDERATION_BALANCE_IN_SATOSHIS = 5000000;

const BOOKKEEPING_CONFIGURATIONS = {
    difficultyTarget: '3',
    informerInterval: '8000',
    maxAmountBlockHeaders: '100',
    maxChunkSizeToHsm: '100',
};

// Every fork active from the first block, as the regular suite does in regtest.
const FORK_NAMES = [
    'orchid',
    'wasabi100',
    'papyrus200',
    'iris300',
    'hop400',
    'hop401',
    'fingerroot500',
    'arrowhead600',
    'arrowhead631',
    'lovell700',
    'reed800',
    'reed810',
    'vetiver900',
    'cardamom1000',
];

const createForkObject = (name) => ({
    name,
    activationHeight: 1,
    isAlreadyActive: async () => true,
});

const getScenarioConfig = () => {
    const configFilePath = process.env.CONFIG_FILE_PATH;
    if (!configFilePath) {
        throw new Error(
            'CONFIG_FILE_PATH is not set. A scenario that uses this bootstrap must declare a configFile in its manifest'
        );
    }
    return require(configFilePath);
};

/**
 * The nodes started so far, in the order they were started.
 * @type {Array<object>}
 */
const startedNodes = [];

/**
 * Starts one more federator node from the scenario's pool.
 *
 * Nothing is stopped and nothing is reconfigured: every node in the pool was already peered with
 * every other one when the configuration was built, so a node started here is immediately known
 * to the ones that are already running.
 * @param {object} nodeConfig a member of the pool, as the config builder produced it
 * @returns {Promise<object>} the node configuration that was started
 */
const startFederatorNode = async (nodeConfig) => {
    if (startedNodes.some((startedNode) => startedNode.id === nodeConfig.id)) {
        throw new Error(`${nodeConfig.id} is already running`);
    }

    const federateConfig = {
        ...nodeConfig,
        customConfig: {
            ...nodeConfig.customConfig,
            // Enough to inform the headers in one call instead of several.
            'federator.amountOfHeadersToSend': 500,
        },
    };

    logger.info(`[scenario-bootstrap] starting ${nodeConfig.id} on rpc port ${nodeConfig.rpcPort}`);
    await federateStarter.startFederate(
        startedNodes.length + 1,
        federateConfig,
        null,
        BOOKKEEPING_CONFIGURATIONS
    );
    // Counted as started only once it answers, so the list never holds a node that nothing can
    // talk to. It has to go in before the peer check, which looks at every node in the list.
    await waitForNodeToBeReady(nodeConfig);
    startedNodes.push(nodeConfig);
    await waitForPeerConnections();

    return nodeConfig;
};

/**
 * The federator nodes that are running right now.
 * @returns {Array<object>}
 */
const getStartedNodes = () => [...startedNodes];

let acquiredLockFilePath = null;

/**
 * Takes a lock on the scenario's generated directory, so two runs of the same scenario cannot
 * use it at once.
 *
 * The port check alone is not enough: for the first half minute a run is only bitcoind on its own
 * ports, with every node port still free, so a second run sails past the check and then clears
 * the data directory out from under the first one's bitcoind. The lock covers that window.
 *
 * A lock whose process is gone is stale and gets taken over, so a run killed halfway does not
 * leave the scenario unusable.
 * @param {string} scenarioDir the scenario's directory under manual-tests/generated
 */
const acquireScenarioLock = (scenarioDir) => {
    const lockFilePath = path.join(scenarioDir, SCENARIO_LOCK_FILE);
    fs.mkdirSync(scenarioDir, { recursive: true });

    try {
        fs.writeFileSync(lockFilePath, String(process.pid), { flag: 'wx' });
        acquiredLockFilePath = lockFilePath;
        return;
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }

    const holderPid = Number(fs.readFileSync(lockFilePath, 'utf8').trim());
    if (!Number.isInteger(holderPid) || holderPid <= 0) {
        logger.warn(`[scenario-bootstrap] taking over a lock file that does not name a process`);
        fs.writeFileSync(lockFilePath, String(process.pid));
        acquiredLockFilePath = lockFilePath;
        return;
    }
    let holderIsAlive;
    try {
        // Signal 0 checks whether the process exists without touching it.
        process.kill(holderPid, 0);
        holderIsAlive = true;
    } catch (error) {
        // EPERM means the process is there but belongs to someone else, which still counts as
        // alive. Only ESRCH, no such process, makes the lock stale.
        holderIsAlive = error.code === 'EPERM';
    }

    if (holderIsAlive) {
        throw new Error(
            `This scenario is already running in process ${holderPid}. Wait for it to finish, or stop it first. ` +
                `Running two at once would clear the chain out from under the one already going`
        );
    }

    logger.warn(
        `[scenario-bootstrap] taking over a stale lock left by process ${holderPid}, which is no longer running`
    );
    fs.writeFileSync(lockFilePath, String(process.pid));
    acquiredLockFilePath = lockFilePath;
};

const releaseScenarioLock = () => {
    if (!acquiredLockFilePath) {
        return;
    }
    try {
        fs.rmSync(acquiredLockFilePath, { force: true });
    } catch {
        // Nothing useful to do about it, and the next run treats it as stale anyway.
    }
    acquiredLockFilePath = null;
};

/**
 * Clears the scenario's own bitcoin data directory, so every run starts on a fresh chain.
 *
 * `cleanEnv.js` does this for the regular suite's directory but knows nothing about the one a
 * manual scenario keeps for itself, which would otherwise carry chain state over between runs
 * while the rsk side starts fresh every time.
 * @param {string} bitcoinDataDir
 */
const resetBitcoinDataDir = (bitcoinDataDir) => {
    // Only ever delete inside the scenario's own generated directory, whatever the config says.
    if (!bitcoinDataDir.includes(`${path.sep}manual-tests${path.sep}generated${path.sep}`)) {
        throw new Error(
            `Refusing to clear ${bitcoinDataDir}: a scenario's bitcoin data directory must live under manual-tests/generated/`
        );
    }
    fs.rmSync(bitcoinDataDir, { recursive: true, force: true });
    fs.mkdirSync(bitcoinDataDir, { recursive: true });
};

/**
 * Whether something is already listening on a port.
 * @param {number} port
 * @returns {Promise<boolean>}
 */
const isPortBusy = (port) =>
    new Promise((resolve) => {
        const socket = new net.Socket();
        const onFree = () => {
            socket.destroy();
            resolve(false);
        };
        socket.setTimeout(PORT_CHECK_TIMEOUT_IN_MILLISECONDS);
        socket.once('error', onFree);
        socket.once('timeout', onFree);
        socket.connect(port, BTC_HOST, () => {
            socket.end();
            resolve(true);
        });
    });

/**
 * Refuses to start if anything already holds the ports this scenario's nodes need.
 *
 * A scenario started while a previous one is still shutting down looks nothing like a port
 * conflict from the inside: the node comes up, answers json-rpc, and simply never finds a peer.
 * Checking first turns that into a sentence that says what to do.
 * @param {Array<object>} nodePool
 */
const assertScenarioPortsAreFree = async (nodePool) => {
    const ports = nodePool.flatMap((node) => [node.port, node.rpcPort]);
    const busyPorts = [];

    for (const port of ports) {
        if (await isPortBusy(port)) {
            busyPorts.push(port);
        }
    }

    if (busyPorts.length > 0) {
        throw new Error(
            `Ports already in use: ${busyPorts.join(', ')}. A previous run may still be shutting down, ` +
                `or another scenario is running. Wait for it to finish, or run \`node cleanEnv.js\``
        );
    }
};

/**
 * One json-rpc call against a node, by port.
 * @param {number} rpcPort
 * @param {string} method
 * @returns {Promise<*>} the result, or undefined if the call did not go through
 */
const callNodeRpc = async (rpcPort, method) => {
    try {
        const response = await fetch(`http://${BTC_HOST}:${rpcPort}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
        });
        const body = await response.json();
        return body.error ? undefined : body.result;
    } catch {
        return undefined;
    }
};

/**
 * Waits until a node answers json-rpc.
 *
 * `federateStarter.startFederate` returns as soon as the ports accept connections, which happens
 * before the node has finished starting. Mining against a network whose nodes are still coming up
 * is how a block ends up on one node and nowhere else.
 * @param {object} nodeConfig
 */
const waitForNodeToBeReady = async (nodeConfig) => {
    const deadline = Date.now() + NODE_READY_TIMEOUT_IN_MILLISECONDS;
    while (Date.now() < deadline) {
        if ((await callNodeRpc(nodeConfig.rpcPort, 'eth_blockNumber')) !== undefined) {
            return;
        }
        await wait(SYNC_POLL_INTERVAL_IN_MILLISECONDS);
    }
    throw new Error(
        `${nodeConfig.id} did not answer json-rpc on port ${nodeConfig.rpcPort} within ${NODE_READY_TIMEOUT_IN_MILLISECONDS} ms`
    );
};

/**
 * Gives the nodes a moment to find each other, and reports what they see.
 *
 * This is a hint, not a gate. Two nodes with a working connection between them routinely
 * disagree about it: the one that dialled reports a peer while the one that accepted reports
 * none, and a node added later reports fewer peers than it has. What actually matters is whether
 * a block reaches everyone, and `settleNetwork` checks that directly.
 */
const waitForPeerConnections = async () => {
    if (startedNodes.length < 2) {
        return;
    }

    const deadline = Date.now() + PEER_CONNECTION_TIMEOUT_IN_MILLISECONDS;
    let peerCounts = [];

    while (Date.now() < deadline) {
        peerCounts = await Promise.all(
            startedNodes.map(async (node) => {
                const peerCount = await callNodeRpc(node.rpcPort, 'net_peerCount');
                return peerCount === undefined ? 0 : Number(peerCount);
            })
        );
        if (peerCounts.every((peerCount) => peerCount > 0)) {
            break;
        }
        await wait(SYNC_POLL_INTERVAL_IN_MILLISECONDS);
    }

    logger.info(
        `[scenario-bootstrap] ${startedNodes.length} node(s) up, peers reported: ${peerCounts.join(', ')}`
    );
};

/**
 * Waits until every running node reports at least `targetBlockNumber`, and says plainly which one
 * did not if it runs out of time.
 *
 * `rskUtils.waitForSync` would do this too, but it retries for about sixteen minutes per node
 * before giving up, which turns a node that is simply not syncing into a very long wait with a
 * confusing error at the end.
 * @param {number} targetBlockNumber
 * @param {number} timeoutInMilliseconds
 */
const waitForNodesToSync = async (targetBlockNumber, timeoutInMilliseconds) => {
    const rskTxHelpers = getRskTransactionHelpers();
    const deadline = Date.now() + timeoutInMilliseconds;
    let blockNumbers = [];

    while (Date.now() < deadline) {
        blockNumbers = await Promise.all(
            rskTxHelpers.map((rskTxHelper) => rskTxHelper.getBlockNumber().catch(() => -1))
        );
        if (blockNumbers.every((blockNumber) => blockNumber >= targetBlockNumber)) {
            logger.info(
                `[scenario-bootstrap] all ${blockNumbers.length} node(s) synced to block ${targetBlockNumber}`
            );
            return;
        }
        await wait(SYNC_POLL_INTERVAL_IN_MILLISECONDS);
    }

    const laggards = startedNodes
        .map((node, index) => ({ id: node.id, blockNumber: blockNumbers[index] }))
        .filter(({ blockNumber }) => blockNumber < targetBlockNumber)
        .map(({ id, blockNumber }) => `${id} at block ${blockNumber}`);

    throw new Error(
        `Nodes did not sync to block ${targetBlockNumber} within ${timeoutInMilliseconds} ms: ${laggards.join(', ')}`
    );
};

/**
 * What the active federation is holding right now, across all of its utxos.
 * @returns {Promise<number>} satoshis
 */
const getActiveFederationBalanceInSatoshis = async () => {
    const rskTxHelper = getRskTransactionHelpers()[0];
    const bridgeState = await getBridgeState(rskUtils.getRskHost(rskTxHelper));
    return bridgeState.activeFederationUtxos.reduce(
        (total, utxo) => total + utxo.valueInSatoshis,
        0
    );
};

/**
 * Sends a handful of pegins to the active federation, so it holds utxos before any federation
 * change is attempted.
 *
 * Without this the SVP never starts: the Bridge quietly declines to create the SVP fund
 * transaction and every updateCollections afterwards does nothing, which looks exactly like a
 * stuck scenario.
 */
const fundActiveFederation = async () => {
    const rskTxHelper = getRskTransactionHelpers()[0];
    const btcTxHelper = getBtcClient();

    const senderRecipientInfo = await createSenderRecipientInfo(
        rskTxHelper,
        btcTxHelper,
        'legacy',
        PEGIN_VALUE_IN_BTC * (INITIAL_PEGINS_COUNT + 2)
    );

    logger.info(
        `[scenario-bootstrap] sending ${INITIAL_PEGINS_COUNT} pegins of ${PEGIN_VALUE_IN_BTC} btc to the active federation`
    );

    const balanceBeforeInSatoshis = await getActiveFederationBalanceInSatoshis();

    let lastPeginBtcTxHash;
    for (let peginNumber = 0; peginNumber < INITIAL_PEGINS_COUNT; peginNumber++) {
        lastPeginBtcTxHash = await sendPeginToActiveFederation(
            rskTxHelper,
            btcTxHelper,
            senderRecipientInfo.btcSenderAddressInfo,
            PEGIN_VALUE_IN_BTC
        );
    }
    await ensurePeginIsRegistered(rskTxHelper, lastPeginBtcTxHash);

    // Only the last pegin is waited on, so check what actually arrived rather than settling for
    // "something did". A partially registered funding would otherwise pass here and resurface
    // much later as the Bridge being unable to pay for an SVP fund transaction.
    const balanceInSatoshis = await getActiveFederationBalanceInSatoshis();
    const expectedIncreaseInSatoshis = btcToSatoshis(INITIAL_PEGINS_COUNT * PEGIN_VALUE_IN_BTC);
    const actualIncreaseInSatoshis = balanceInSatoshis - balanceBeforeInSatoshis;

    if (actualIncreaseInSatoshis < expectedIncreaseInSatoshis) {
        throw new Error(
            `The active federation only gained ${satoshisToBtc(actualIncreaseInSatoshis)} btc from ` +
                `${INITIAL_PEGINS_COUNT} pegins of ${PEGIN_VALUE_IN_BTC} btc, expected ` +
                `${satoshisToBtc(expectedIncreaseInSatoshis)} btc. Some of them did not register`
        );
    }

    logger.info(
        `[scenario-bootstrap] the active federation holds ${satoshisToBtc(balanceInSatoshis)} btc`
    );
};

/**
 * Gives the given federator nodes the rsk balance they need to work.
 *
 * A federator pays gas out of its own rsk account every time it sends `addSignature`, and only
 * the three genesis federators are funded in the regtest genesis block. Every node this scenario
 * adds beyond them starts with nothing, so it silently never signs: the pegout sits in the
 * Bridge's waiting-for-signatures queue forever and the change times out with no error anywhere.
 * That is what stopped the first full walk at 6 members, the first size that needs a fourth node.
 * @param {Array<object>} nodeConfigs
 */
const fundFederatorNodes = async (nodeConfigs) => {
    if (nodeConfigs.length === 0) {
        return;
    }
    const rskTxHelper = getRskTransactionHelpers()[0];
    await fundNewFederators(rskTxHelper, nodeConfigs);
    logger.info(
        `[scenario-bootstrap] funded the rsk accounts of ${nodeConfigs.length} federator node(s)`
    );
};

/**
 * Tops the active federation up when it is running low, so a change never fails for want of
 * funds halfway through a long walk.
 * @returns {Promise<boolean>} whether it topped up
 */
const topUpActiveFederationIfNeeded = async () => {
    const balanceInSatoshis = await getActiveFederationBalanceInSatoshis();
    if (balanceInSatoshis >= MINIMUM_FEDERATION_BALANCE_IN_SATOSHIS) {
        return false;
    }
    logger.info(
        `[scenario-bootstrap] the active federation is down to ${satoshisToBtc(balanceInSatoshis)} btc, topping it up`
    );
    await fundActiveFederation();
    return true;
};

/**
 * Mines a few rsk blocks and confirms every node followed, so a scenario starts on a network that
 * is known to be relaying.
 */
const settleNetwork = async () => {
    const rskTxHelpers = getRskTransactionHelpers();

    // A node that has just joined sometimes needs another block before it starts following the
    // chain, so give it several rounds rather than one long wait on the first batch.
    let lastError;
    for (let attempt = 1; attempt <= SETTLE_ATTEMPTS; attempt++) {
        const startingBlockNumber = await rskTxHelpers[0].getBlockNumber();
        const targetBlockNumber = startingBlockNumber + INITIAL_RSK_BLOCKS;

        logger.info(
            `[scenario-bootstrap] mining ${INITIAL_RSK_BLOCKS} rsk blocks to settle the network (attempt ${attempt} of ${SETTLE_ATTEMPTS})`
        );
        await rskTxHelpers[0].mine(INITIAL_RSK_BLOCKS);

        try {
            await waitForNodesToSync(targetBlockNumber, SETTLE_SYNC_TIMEOUT_IN_MILLISECONDS);
            return;
        } catch (error) {
            lastError = error;
            logger.warn(`[scenario-bootstrap] ${error.message}`);
        }
    }

    throw lastError;
};

const stopEverything = () => {
    // The before hook can throw before it assigns global.Runners, on a busy port or a held lock,
    // and mocha runs the after hook anyway. Reading Runners directly would raise a ReferenceError
    // that buries the real error and skips the lock release below.
    const runners = global.Runners || {};

    for (const fedRunner of runners.fedRunners || []) {
        try {
            fedRunner.stop();
        } catch (error) {
            logger.warn(`[scenario-bootstrap] could not stop a federator node: ${error.message}`);
        }
    }

    if (runners.btcRunner) {
        try {
            runners.btcRunner.stop();
        } catch (error) {
            logger.warn(`[scenario-bootstrap] could not stop bitcoind: ${error.message}`);
        }
    }

    // Last, so the next run cannot take the lock and clear the data directory while this
    // bitcoind is still shutting down and still holding it.
    releaseScenarioLock();
};

process.on('SIGINT', () => {
    stopEverything();
    process.exit(1);
});
process.on('SIGTERM', () => {
    stopEverything();
    process.exit(1);
});

before(async function () {
    const config = getScenarioConfig();

    acquireScenarioLock(path.dirname(config.btc.dir));
    await assertScenarioPortsAreFree(config.nodePool);
    resetBitcoinDataDir(config.btc.dir);

    global.Runners = {
        hosts: {},
        common: {
            forks: Object.fromEntries(FORK_NAMES.map((name) => [name, createForkObject(name)])),
            additionalFederationAddresses: [],
        },
        config,
    };

    const btcStderr = new LineWrapper({ prefix: colors.green('bitcoind:') });
    btcStderr.pipe(process.stderr);
    Runners.btcRunner = new BitcoinRunner({ ...config.btc, stderr: btcStderr });
    await Runners.btcRunner.start();

    Runners.hosts.bitcoin = {
        rpcHost: `${BTC_HOST}:${Runners.btcRunner.ports.rpc}`,
        peerHost: `${BTC_HOST}:${Runners.btcRunner.ports.btc}`,
        rpcUser: config.btc.rpcUser,
        rpcPassword: config.btc.rpcPassword,
        network: btcNetworks.regtest,
    };
    logger.info(
        `[scenario-bootstrap] bitcoind running on p2p port ${Runners.btcRunner.ports.btc}, rpc port ${Runners.btcRunner.ports.rpc}`
    );

    if (config.init.mineInitialBitcoin) {
        await getBtcClient().mine(INITIAL_BTC_BLOCKS);
        logger.info(`[scenario-bootstrap] mined ${INITIAL_BTC_BLOCKS} initial bitcoin blocks`);
    }

    for (const nodeConfig of config.federations.genesisFederation.members) {
        await startFederatorNode(nodeConfig);
    }

    await settleNetwork();
    await fundFederatorNodes(getStartedNodes());
    await fundActiveFederation();
});

after(function () {
    stopEverything();
});

module.exports = {
    startFederatorNode,
    getStartedNodes,
    settleNetwork,
    fundFederatorNodes,
    topUpActiveFederationIfNeeded,
    getActiveFederationBalanceInSatoshis,
};
