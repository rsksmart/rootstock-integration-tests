/**
 * Builds the node configuration a manual scenario runs on.
 *
 * The regular regtest configs spell out every node by hand: four federations, three members each,
 * every port, node id, peer entry and file path written out, which is around 700 lines for twelve
 * nodes that never change. A scenario that walks a federation from 3 up to 20 members cannot be
 * written that way, so this builder derives all of it instead.
 *
 * What is fixed: the federator private keys (see ./federator-keys) and the base port. Everything
 * else - public keys, node ids, ports, peering, key file paths, logback paths - is derived.
 *
 * Two decisions worth knowing about:
 *
 * - **Every node is given the whole pool as peers, not just the nodes that are running.** A
 *   scenario starts a few nodes and adds more later, and a running node never re-reads its peer
 *   list. Meshing all 20 up front means a node that joins later is already known to everyone;
 *   until it starts, it is just a peer that is not answering, which rskj retries on its own.
 *
 * - **One shared .conf file, per-node values as -D overrides.** `lib/federate-runner.js` turns
 *   every `customConfig` entry into a `-D`, and rskj layers system properties above the file in
 *   `-Drsk.conf.file`, so nothing has to be templated or generated per node.
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

// The only mode the powpeg node accepts for a signing key, and the one it has to be relaxed to
// for the builder to be able to rewrite it.
const KEY_FILE_MODE = 0o400;
const KEY_FILE_WRITABLE_MODE = 0o600;

// The powpeg node's reference.conf sets `rpc.timeout = 5000`, and a single `evm_mine` on a
// machine running ten federator JVMs does not always come back inside five seconds. When it does
// not, the node answers with a JsonRpcTimeoutError, which surfaces here as a federation change
// failing for no reason of its own: one such timeout landed in the middle of mining towards an
// activation height and failed the 17 member change of an otherwise clean run, with 37 timeouts
// logged across that run, all of them in its second half where the node count was highest.
//
// Generous rather than disabled (zero turns it off): a call that is genuinely stuck should still
// end in an error, just not one caused by the machine being busy.
const RPC_TIMEOUT_IN_MILLISECONDS = 120000;

/**
 * The p2p and rpc ports of a federator. They are derived from its position in the pool, so a
 * federator keeps the same ports whether it is started at the beginning of a scenario or halfway
 * through, which is what lets the peer mesh be built once, up front.
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
 * The powpeg node refuses to start on a key file that is anything other than read only for its
 * owner: `KeyFileChecker#checkFilePermissions` accepts exactly one permission, OWNER_READ. Since
 * a file already at that mode cannot be rewritten, it is made writable first and locked down
 * again afterwards, which keeps the builder safe to run twice.
 * @param {object} federator
 * @param {string} keysDir
 * @returns {string} the key file path
 */
const writeKeyFile = (federator, keysDir) => {
    fs.mkdirSync(keysDir, { recursive: true });
    const keyFilePath = path.join(keysDir, `${federator.name}.key`);

    if (fs.existsSync(keyFilePath)) {
        fs.chmodSync(keyFilePath, KEY_FILE_WRITABLE_MODE);
    }
    fs.writeFileSync(keyFilePath, `${federator.privateKey}\n`, 'utf8');
    fs.chmodSync(keyFilePath, KEY_FILE_MODE);

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
    getPortsFor,
    buildFederatorNodeConfig,
    buildFederatorNodePool,
    buildScenarioConfig,
};
