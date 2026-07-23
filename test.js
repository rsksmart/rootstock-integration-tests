require('dotenv').config();
const { globSync } = require('glob');
const colors = require('colors/safe');
const LineWrapper = require('stream-line-wrapper');
const expect = require('chai').expect;
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const BitcoinRunner = require('./lib/bitcoin-runner').Runner;

const federateStarter = require('./lib/federate-starter');
const rskUtils = require('./lib/rsk-utils');
const btcNetworks = require('@rsksmart/btc-transaction-helper').networks;
const {
    getRskTransactionHelpers,
    getRskTransactionHelper,
} = require('./lib/rsk-tx-helper-provider');
const { getBtcClient } = require('./lib/btc-client-provider');

// Require a mocha environment
if (global.describe == null || global.it == null) {
    process.stdout.write("Please run with 'npm test'\n");
    process.exit(1);
}

// Per-phase timing (setup/mine/tests/teardown) for the CI run summary. Requiring this
// self-registers root hooks; the mine() calls below are bracketed with its marks. Diagnostic
// only — it never affects the run.
const phaseTiming = require('./lib/phase-timing');

// Load the configuration, regtest by default
const configFileName = process.env.CONFIG_FILE_PATH || './config/regtest-all-keyfiles';

const config = require(configFileName);

// Load cases to test, everything by default
const testCasesInclude =
    process.env.INCLUDE_CASES != null ? process.env.INCLUDE_CASES.split(',') : null;
const testCasesExclude =
    process.env.EXCLUDE_CASES != null ? process.env.EXCLUDE_CASES.split(',') : null;

// 'short' skips every tests/**/extra/ folder. 'full' (default) runs everything.
const testSuite = process.env.TEST_SUITE || 'full';

// ***** CONSTANTS ***** //
const outputConfig = config.output || {};
const BITCOIND_OUTPUT = outputConfig.bitcoindPrefix || colors.green('bitcoind:');
const INITIAL_BTC_BLOCKS = 400;

const BTC_HOST = '127.0.0.1';

const bookkeepingConfigurations = {
    difficultyTarget: '3',
    informerInterval: '8000',
    maxAmountBlockHeaders: '100',
    maxChunkSizeToHsm: '100',
};

/**
 * Creates a fork object with the provided name and activation height.
 * The fork object will have a method called `isAlreadyActive` to check if the fork is already active,
 * which will get the latest block number and compare it with the `activationHeight` and cache the result to avoid calling the blockchain again
 * if the fork is already active because a fork is activated only once.
 * @param {string} name
 * @param {number} activationHeight
 * @returns {{name: string, activationHeight: number, isAlreadyActive: function(RskTransactionHelper): Promise<boolean>}}
 */
const createForkObject = (name, activationHeight) => {
    // 'Private' variable to hold if the fork is already active
    let isActive = false;

    async function isAlreadyActive(rskTxHelper) {
        // If the fork is already active, then return the cached result
        if (isActive) {
            return isActive;
        }
        if (this.activationHeight === -1) {
            return false;
        }
        rskTxHelper = rskTxHelper || getRskTransactionHelper();
        // Cache the result to avoid calling the network again if the fork is already active
        const latestBlockNumber = await rskTxHelper.getBlockNumber();
        isActive = latestBlockNumber >= this.activationHeight;
        return isActive;
    }

    return {
        name,
        activationHeight,
        isAlreadyActive,
    };
};

// ***** GLOBALS ***** //
global.Runners = {
    hosts: {},
    common: {
        forks: {
            orchid: createForkObject('orchid', 1),
            wasabi100: createForkObject('wasabi100', 1),
            papyrus200: createForkObject('papyrus200', 1),
            iris300: createForkObject('iris300', 1),
            hop400: createForkObject('hop400', 1),
            hop401: createForkObject('hop401', 1),
            fingerroot500: createForkObject('fingerroot500', 1),
            arrowhead600: createForkObject('arrowhead600', 1),
            arrowhead631: createForkObject('arrowhead631', 1),
            lovell700: createForkObject('lovell700', 1),
            reed800: createForkObject('reed800', 1),
            reed810: createForkObject('reed810', 1),
            vetiver900: createForkObject('vetiver900', 1),
            tbd1000: createForkObject('tbd1000', 1),
        },
        additionalFederationAddresses: [],
    },
};

Runners.config = config;

function validateBitcoinRunnerConfig(bitcoinConf, configs) {
    for (const config of configs) {
        if (!bitcoinConf[config]) {
            process.stdout.write(
                `NO runnersConfig.bitcoin.${config} defined on ${configFileName}.js\n`
            );
            process.exit(1);
        }
    }
}

async function printPowpegJarSha256() {
    const jarPath = process.env.POWPEG_NODE_JAR_PATH;
    if (!jarPath) return;
    try {
        console.log(`Computing sha256 for powpeg node jar (POWPEG_NODE_JAR_PATH): ${jarPath}...`);
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(jarPath);
        await new Promise((resolve, reject) => {
            stream.on('data', (chunk) => hash.update(chunk));
            stream.on('end', resolve);
            stream.on('error', reject);
        });
        console.log(`Powpeg node jar sha256: ${hash.digest('hex')}`);
        console.log('');
    } catch (e) {
        console.log(`Could not compute sha256 for powpeg node jar (${jarPath}): ${e.message}`);
    }
}

process.on('SIGTERM', function () {
    process.stdout.write('\nGracefully shutting down from SIGTERM.');
    shutdownHooks();
    process.exit(1);
});

process.on('SIGINT', function () {
    process.stdout.write('\nGracefully shutting down from SIGINT (Ctrl-C)');
    shutdownHooks();
    process.exit(1);
});

process.on('SIGUSR1', function () {
    shutdownHooks();
    process.exit(1);
});

process.on('SIGUSR2', function () {
    shutdownHooks();
    process.exit(1);
});

before(async () => {
    const runnersConfig = config.runners || {};
    const initConfig = config.init || {};

    await printPowpegJarSha256();

    // Start bitcoin daemon if needed
    if (runnersConfig.bitcoin == null) {
        const btcStderr = new LineWrapper({ prefix: BITCOIND_OUTPUT });
        btcStderr.pipe(process.stderr);
        const btcConfig = Object.assign({}, config.btc, {
            stderr: btcStderr,
        });
        Runners.btcRunner = new BitcoinRunner(btcConfig);

        try {
            await Runners.btcRunner.start();
            Runners.hosts.bitcoin = {
                rpcHost: BTC_HOST + ':' + Runners.btcRunner.ports.rpc,
                peerHost: BTC_HOST + ':' + Runners.btcRunner.ports.btc,
                rpcUser: btcConfig.rpcUser,
                rpcPassword: btcConfig.rpcPassword,
                network: btcNetworks.regtest,
            };
            process.stdout.write(
                `${BITCOIND_OUTPUT} running on port ${Runners.btcRunner.ports.btc}, rpc port ${Runners.btcRunner.ports.rpc}, directory ${Runners.btcRunner.getDataDir()} (PID: ${Runners.btcRunner.getPid()})\n`
            );
            if (initConfig.mineInitialBitcoin) {
                phaseTiming.mark('mineStart');
                try {
                    const btcTxHelper = getBtcClient();
                    await btcTxHelper.mine(INITIAL_BTC_BLOCKS);
                } finally {
                    // Record mineEnd even if mining throws, so the phase breakdown stays
                    // meaningful on the failing runs where it is most useful.
                    phaseTiming.mark('mineEnd');
                }
            }
            process.stdout.write(
                `${BITCOIND_OUTPUT} generated initial ${INITIAL_BTC_BLOCKS} blocks\n`
            );
        } catch (ex) {
            process.stdout.write(`${BITCOIND_OUTPUT} ${ex.stack} \n`);
            throw new Error(ex.toString(), { cause: ex });
        }
    } else {
        const fieldsToValidate = ['host', 'port', 'rpcPort', 'rpcUser', 'rpcPassword'];

        validateBitcoinRunnerConfig(runnersConfig.bitcoin, fieldsToValidate);

        Runners.hosts.bitcoin = {
            rpcHost: runnersConfig.bitcoin.host + ':' + runnersConfig.bitcoin.rpcPort,
            peerHost: runnersConfig.bitcoin.host + ':' + runnersConfig.bitcoin.port,
            rpcPort: runnersConfig.bitcoin.rpcPort,
            rpcUser: runnersConfig.bitcoin.rpcUser,
            rpcPassword: runnersConfig.bitcoin.rpcPassword,
            network: btcNetworks.regtest,
        };
        if (initConfig.mineInitialBitcoin) {
            phaseTiming.mark('mineStart');
            try {
                const btcTxHelper = getBtcClient();
                await btcTxHelper.mine(INITIAL_BTC_BLOCKS);
            } finally {
                // Record mineEnd even if mining throws, so the phase breakdown stays
                // meaningful on the failing runs where it is most useful.
                phaseTiming.mark('mineEnd');
            }
        }
    }

    try {
        // Start federate node if needed

        // First, append existing federates, if any
        if (runnersConfig.federates != null) {
            for (const federateRunnerConfig of runnersConfig.federates) {
                const federateRunner = {
                    federationId: federateRunnerConfig.federationId,
                    host: federateRunnerConfig.host,
                    publicKeys: federateRunnerConfig.publicKeys,
                };

                Runners.hosts.federate = Runners.hosts.federate || federateRunner;
                Runners.hosts.federates = Runners.hosts.federates || [];
                Runners.hosts.federates.push(federateRunner);
            }
        }

        // Start desired federates
        const federatesToStart = config.federations.genesisFederation.members;
        const getConfigForFederateNodes = (federateToStart) => {
            // Configure ports
            var config = {
                ...federateToStart,
                port: federateToStart.port,
                rpcPort: federateToStart.rpcPort,
            };
            if (!config.customConfig) {
                config.customConfig = {};
            }
            // Set amountOfHeadersToSend to 500 to avoid having to inform headers in separated calls
            config.customConfig[`federator.amountOfHeadersToSend`] = 500;

            return config;
        };

        await startFederates(1, federatesToStart.map(getConfigForFederateNodes));
        config.additionalFederateNodes = config.additionalFederateNodes || [];
        Runners.startAdditionalFederateNodes = Promise.resolve();

        if (config.additionalFederateNodes.length != 0) {
            Runners.startAdditionalFederateNodes = async (latestBlock) => {
                if (latestBlock.number < 500) {
                    const blocksToMine = 500 - latestBlock.number;
                    const rskTransactionHelpers = getRskTransactionHelpers();

                    await rskUtils.mineAndSync(rskTransactionHelpers, blocksToMine);

                    latestBlock = await rskTransactionHelpers[0].getBlock('latest');
                }

                process.stdout.write(
                    `\n Starting additional Federate nodes from block ${latestBlock.hash}. Height: ${latestBlock.number} \n\n`
                );
                return await startFederates(
                    federatesToStart.length + 1,
                    config.additionalFederateNodes.map(getConfigForFederateNodes),
                    latestBlock.hash
                );
            };
        }

        process.stdout.write('\n');
    } catch (ex) {
        process.stdout.write(`Error starting federate nodes ${ex.stack} \n`);
        throw new Error(ex.toString(), { cause: ex });
    }
});

beforeEach(() => {
    expect(Runners.btcRunner == null || Runners.btcRunner.isRunning(), 'Bitcoind is not running').to
        .be.ok;
    expect(
        Runners.fedRunner == null || Runners.fedRunner.isRunning(),
        'Federate node is not running'
    ).to.be.ok;
});

const startFederates = async (fedIndexStartsAt, configs, latestBlockHash) => {
    if (configs.length === 0) {
        return Promise.resolve();
    }

    try {
        for (let i = 0; i < configs.length; i++) {
            await federateStarter.startFederate(
                fedIndexStartsAt + i,
                configs[i],
                latestBlockHash,
                bookkeepingConfigurations
            );
        }
    } catch (ex) {
        process.stdout.write(`There was a problem starting a Federate. ${ex}\n`);
        throw new Error(ex.toString(), { cause: ex });
    }
};

const shutdownHooks = () => {
    // Stop bitcoin daemon and federate node(s)
    if (Runners.fedRunners != null) {
        for (const fedRunner of Runners.fedRunners) {
            fedRunner.stop();
            if (fedRunner.hsm) {
                fedRunner.hsm.stop();
                fedRunner.hsm = null;
            }
        }
    }

    if (Runners.btcRunner != null) {
        Runners.btcRunner.stop();
        process.stdout.write(`${BITCOIND_OUTPUT} stopped\n`);
    }
};

after(() => {
    // For some reason if we don't run this, a cleanup of any temp dirs
    // and halt of the spawned processes happens anyway. Mocha behavior maybe?
    shutdownHooks();
});

const needsToBeTested = function (testFile) {
    const testFileName = path.basename(testFile);
    const relativePath = path.relative('tests', testFile); // e.g. '01_powpeg/extra/05-2wp-full.js'
    // Patterns match either the bare filename or the path relative to tests/, so a group folder
    // can be used as a qualifier (e.g. '01_powpeg/', '01_powpeg/extra', '01_powpeg/01').
    // Note: number-only prefixes can match files in several folders since file numbering is
    // folder-local; use the descriptive name or a path-qualified pattern to disambiguate.
    const matches = (pattern) =>
        testFileName.startsWith(pattern) || relativePath.startsWith(pattern);
    // Order is include, exclude
    if (testCasesInclude != null && testCasesInclude.some(matches)) {
        return true;
    }
    if (testCasesExclude != null && testCasesExclude.some(matches)) {
        return false;
    }
    return testCasesInclude == null;
};

const runTestThisTimes = process.env.RUN_EACH_TEST_FILE_THESE_TIMES || 1;

// Register tests
const testsGlobPattern = './tests/**/*.js';
const sortedTests = globSync(testsGlobPattern)
    .map((test) => `./${test}`)
    .filter((test) => needsToBeTested(test))
    // The 'short' suite skips the extra/ folder inside each test group
    .filter((test) => testSuite !== 'short' || !test.includes('/extra/'))
    // Tests depend on the blockchain state left by previous ones, so they must run in the order
    // dictated by the folder structure: numbered group folders run in sequence, and within each
    // group the extra/ tests run after the short ones (digits sort before the letter 'e').
    .sort((testA, testB) => testA.localeCompare(testB));
for (const test of sortedTests) {
    for (let i = 0; i < runTestThisTimes; i++) {
        delete require.cache[require.resolve(test)];
        require(test);
    }
}
