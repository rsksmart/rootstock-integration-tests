/**
 * Builds the node configuration a manual scenario runs on, deriving everything from the federator
 * keys in ./federator-keys: public keys, node ids, ports, peering and file paths.
 *
 * Every node gets the whole pool as peers, not just the nodes running, because a node never
 * re-reads its peer list and scenarios add nodes as they go. All nodes share one .conf and differ
 * only in -D overrides, which federate-runner passes through and rskj layers above the file.
 */
const fs = require('node:fs');
const path = require('node:path');
const { applyFullMeshPeering } = require('../../config/peer-topology');
const {
    MAX_FEDERATORS_COUNT,
    getFederators,
    getRequiredSignaturesCount,
} = require('./federator-keys');

const MANUAL_TESTS_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(MANUAL_TESTS_DIR, '..');

// Well clear of the 30000-30023 range the regular regtest configs occupy, so a manual scenario
// and the regular suite do not fight over ports if both are running.
const DEFAULT_BASE_PORT = 30100;
const DEFAULT_BASE_CONFIG_FILE = path.join(__dirname, 'federator-node.conf');
const DEFAULT_GENERATED_DIR = path.join(MANUAL_TESTS_DIR, 'generated');

const PORTS_PER_NODE = 2;

// The only mode the powpeg node accepts for a signing key.
const KEY_FILE_MODE = 0o400;

// The powpeg node defaults to `rpc.timeout = 5000`, which a single `evm_mine` can exceed on a
// machine running ten federator JVMs. The node then answers JsonRpcTimeoutError and the change
// fails for no reason of its own. Generous rather than disabled, since zero turns it off.
const RPC_TIMEOUT_IN_MILLISECONDS = 120000;

/**
 * The p2p and rpc ports of a federator, derived from its position in the pool so they are the
 * same whenever it starts. That is what lets the peer mesh be built once, up front.
 * @param {object} federator
 * @param {number} basePort
 * @returns {{port: number, rpcPort: number}}
 */
const getPortsFor = (federator, basePort) => {
    const firstPort = basePort + (federator.number - 1) * PORTS_PER_NODE;
    return { port: firstPort, rpcPort: firstPort + 1 };
};

/**
 * Writes a federator's signing key where the node can read it, and returns the path.
 *
 * `KeyFileChecker#checkFilePermissions` accepts exactly one permission, OWNER_READ, and a file at
 * that mode cannot be rewritten. Removing it and creating the replacement with the mode in one
 * step keeps this safe to run twice.
 * @param {object} federator
 * @param {string} keysDir
 * @returns {string} the key file path
 */
const writeKeyFile = (federator, keysDir) => {
    fs.mkdirSync(keysDir, { recursive: true });
    const keyFilePath = path.join(keysDir, `${federator.name}.key`);

    // `force` means no error when there is nothing to remove, so this is the same on a first run
    // and on a rerun.
    fs.rmSync(keyFilePath, { force: true });
    fs.writeFileSync(keyFilePath, `${federator.privateKey}\n`, {
        encoding: 'utf8',
        mode: KEY_FILE_MODE,
    });

    return keyFilePath;
};

/**
 * Builds the runnable configuration of one federator node, in the shape
 * `lib/federate-starter.js` expects.
 * @param {object} federator
 * @param {object} options
 * @returns {object}
 */
const buildFederatorNodeConfig = (federator, options) => {
    const { scenarioName, basePort, baseConfigFile, keysDir, logbackDir, classpath } = options;
    const { port, rpcPort } = getPortsFor(federator, basePort);
    const keyFilePath = writeKeyFile(federator, keysDir);
    const publicKey = `0x${federator.publicKey}`;

    return {
        id: `federator-${federator.number}-${scenarioName}`,
        federationId: scenarioName,
        logbackFile: path.join(logbackDir, scenarioName, `${federator.name}.xml`),
        classpath,
        configFile: baseConfigFile,
        // BTC, RSK and MST are the same key, as they are in the regular regtest configs.
        publicKeys: { btc: publicKey, rsk: publicKey, mst: publicKey },
        port,
        rpcPort,
        nodeId: federator.nodeId,
        customConfig: {
            'peer.privateKey': federator.privateKey,
            'rpc.timeout': RPC_TIMEOUT_IN_MILLISECONDS,
            'federator.signers.BTC.type': 'keyFile',
            'federator.signers.BTC.path': keyFilePath,
            'federator.signers.RSK.type': 'keyFile',
            'federator.signers.RSK.path': keyFilePath,
            'federator.signers.MST.type': 'keyFile',
            'federator.signers.MST.path': keyFilePath,
        },
    };
};

/**
 * Builds the configuration of every federator in the pool, fully peered with each other.
 * @param {object} [options]
 * @returns {Array<object>} one node configuration per federator, in pool order
 */
const buildFederatorNodePool = (options = {}) => {
    const scenarioName = options.scenarioName || process.env.MANUAL_TEST_SCENARIO || 'manual-test';
    const classpath = options.classpath || process.env.POWPEG_NODE_JAR_PATH;

    if (!classpath) {
        throw new Error(
            'POWPEG_NODE_JAR_PATH is not set, so there is no powpeg node jar to start the federators with'
        );
    }

    const poolSize = options.poolSize || MAX_FEDERATORS_COUNT;
    const basePort =
        options.basePort || Number(process.env.MANUAL_TEST_BASE_PORT) || DEFAULT_BASE_PORT;
    const generatedDir = options.generatedDir || DEFAULT_GENERATED_DIR;

    const nodeOptions = {
        scenarioName,
        classpath,
        basePort,
        baseConfigFile: options.baseConfigFile || DEFAULT_BASE_CONFIG_FILE,
        keysDir: path.join(generatedDir, scenarioName, 'keys'),
        logbackDir: options.logbackDir || process.env.LOG_HOME || path.join(REPO_ROOT, 'logs'),
    };

    const members = getFederators(poolSize).map((federator) =>
        buildFederatorNodeConfig(federator, nodeOptions)
    );

    // Peer every node with every other one, including the ones a scenario has not started yet.
    applyFullMeshPeering({ [scenarioName]: { members } });

    return members;
};

/**
 * Builds the whole configuration object a scenario runs on, in the shape `test.js` and the
 * scenario bootstraps read.
 *
 * `federations.genesisFederation.members` holds only the nodes that should be started at the
 * beginning. The rest of the pool is returned under `nodePool` for a scenario to start later.
 * @param {object} [options]
 * @param {number} [options.initialFederationSize] how many federators the genesis federation has,
 *   which decides how many nodes are started: half of them plus one
 * @returns {object}
 */
const buildScenarioConfig = (options = {}) => {
    const scenarioName = options.scenarioName || process.env.MANUAL_TEST_SCENARIO || 'manual-test';
    const generatedDir = options.generatedDir || DEFAULT_GENERATED_DIR;
    const initialFederationSize = options.initialFederationSize || 3;
    const nodePool = buildFederatorNodePool({
        ...options,
        scenarioName,
        generatedDir,
        poolSize: MAX_FEDERATORS_COUNT,
    });
    const initialNodesCount =
        options.initialNodesCount || getRequiredSignaturesCount(initialFederationSize);

    // A scenario keeps its own bitcoin data directory rather than sharing the one the regular
    // suite uses, so a manual run and a regular one cannot trip over each other's chain state,
    // and a run started by a different user cannot leave a directory this one cannot write to.
    const bitcoinDataDir = path.join(generatedDir, scenarioName, 'bitcoin-data');
    fs.mkdirSync(bitcoinDataDir, { recursive: true });

    return {
        init: {
            mineInitialBitcoin: true,
            federatesLogbackFile: process.env.LOG_HOME || path.join(REPO_ROOT, 'logs'),
        },
        btc: {
            rpcUser: 'test',
            rpcPassword: 'test',
            dir: bitcoinDataDir,
        },
        federations: {
            genesisFederation: {
                federationId: scenarioName,
                members: nodePool.slice(0, initialNodesCount),
            },
        },
        additionalFederateNodes: [],
        nodePool,
    };
};

module.exports = {
    DEFAULT_BASE_PORT,
    RPC_TIMEOUT_IN_MILLISECONDS,
    KEY_FILE_MODE,
    buildScenarioConfig,
};
