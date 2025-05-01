require('dotenv').config();
const glob = require('glob');
const colors = require('colors/safe');
const LineWrapper = require('stream-line-wrapper');
const expect = require('chai').expect;
const path = require('path');

const BitcoinRunner = require('./lib/bitcoin-runner').Runner;

const federateStarter = require('./lib/federate-starter');
const rskUtils = require('./lib/rsk-utils');
const btcNetworks = require('btc-transaction-helper').networks;
const { getRskTransactionHelpers, getRskTransactionHelper } = require('./lib/rsk-tx-helper-provider');
const { getBtcClient } = require('./lib/btc-client-provider');

// Require a mocha environment
if (global.describe == null || global.it == null) {
  process.stdout.write('Please run with \'npm test\'\n');
  process.exit(1);
}

// Load the configuration, regtest by default
const configFileName = process.env.CONFIG_FILE_PATH || './config/regtest-all-keyfiles';

const config = require(configFileName);

// Load cases to test, everything by default
const testCasesInclude = process.env.INCLUDE_CASES != null ? process.env.INCLUDE_CASES.split(',') : null;
const testCasesExclude = process.env.EXCLUDE_CASES != null ? process.env.EXCLUDE_CASES.split(',') : null;

// ***** CONSTANTS ***** //
const outputConfig = config.output || {};
const BITCOIND_OUTPUT = outputConfig.bitcoindPrefix || colors.green('bitcoind:');
const INITIAL_BTC_BLOCKS = 400;

const HOST = '127.0.0.1';
const BTC_HOST = '127.0.0.1';

const bookkeepingConfigurations = {
  difficultyTarget: "3",
  informerInterval: "2000",
  maxAmountBlockHeaders: "100",
  maxChunkSizeToHsm: "100",
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
    if(isActive) {
      return isActive;
    }
    if(this.activationHeight === -1) {
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
      lovell700: createForkObject('lovell700', 1750),
    },
    additionalFederationAddresses: []
  }
};

Runners.config = config;

function validateBitcoinRunnerConfig(bitcoinConf, configs){
  configs.forEach(function(config){
    if(!bitcoinConf[config]) {
      process.stdout.write(`NO runnersConfig.bitcoin.${config} defined on ${configFileName}.js\n`);
      process.exit(1);
    };
  });
};

process.on('SIGTERM', function() {
  process.stdout.write( "\nGracefully shutting down from SIGTERM." );
  shutdownHooks();
  process.exit(1);
});

process.on('SIGINT', function() {
  process.stdout.write( "\nGracefully shutting down from SIGINT (Ctrl-C)" );
  shutdownHooks();
  process.exit(1);
});

process.on('SIGUSR1', function() {
  shutdownHooks();
  process.exit(1);
});

process.on('SIGUSR2', function() {
  shutdownHooks();
  process.exit(1);
});

before(async () => {
  const runnersConfig = config.runners || {};
  const initConfig = config.init || {};

  // Start bitcoin daemon if needed
  if (runnersConfig.bitcoin == null) {
    const btcStderr = new LineWrapper({ prefix: BITCOIND_OUTPUT });
    btcStderr.pipe(process.stderr);
    const btcConfig = Object.assign({}, config.btc, {
      stderr: btcStderr
    });
    Runners.btcRunner = new BitcoinRunner(btcConfig);

    try {
      await Runners.btcRunner.start();
      Runners.hosts.bitcoin = {
        rpcHost: BTC_HOST + ":" + Runners.btcRunner.ports.rpc,
        peerHost: BTC_HOST + ":" + Runners.btcRunner.ports.btc,
        rpcUser: btcConfig.rpcUser,
        rpcPassword: btcConfig.rpcPassword,
        network: btcNetworks.regtest
      };
      process.stdout.write(`${BITCOIND_OUTPUT} running on port ${Runners.btcRunner.ports.btc}, rpc port ${Runners.btcRunner.ports.rpc}, directory ${Runners.btcRunner.getDataDir()} (PID: ${Runners.btcRunner.getPid()})\n`);
      if (initConfig.mineInitialBitcoin) {
        const btcTxHelper = getBtcClient();
        await btcTxHelper.mine(INITIAL_BTC_BLOCKS);
      }
      process.stdout.write(`${BITCOIND_OUTPUT} generated initial ${INITIAL_BTC_BLOCKS} blocks\n`);
    } catch(ex) {
      process.stdout.write(`${BITCOIND_OUTPUT} ${ex.stack} \n`);
      throw new Error(ex.toString());
    }
  } else {
    const fieldsToValidate = ["host", "port", "rpcPort", "rpcUser", "rpcPassword"];
    
    validateBitcoinRunnerConfig(runnersConfig.bitcoin, fieldsToValidate);

    Runners.hosts.bitcoin = {
      rpcHost: runnersConfig.bitcoin.host + ":" + runnersConfig.bitcoin.rpcPort,
      peerHost: runnersConfig.bitcoin.host + ":" + runnersConfig.bitcoin.port, 
      rpcPort: runnersConfig.bitcoin.rpcPort,
      rpcUser: runnersConfig.bitcoin.rpcUser,
      rpcPassword: runnersConfig.bitcoin.rpcPassword,
      network: btcNetworks.regtest
    };
    if (initConfig.mineInitialBitcoin) {
      const btcTxHelper = getBtcClient();
      await btcTxHelper.mine(INITIAL_BTC_BLOCKS);
    }
  }

  try {
    // Start federate node if needed

    // First, append existing federates, if any
    if (runnersConfig.federates != null) {
      runnersConfig.federates.forEach((federateRunnerConfig) => {
        const federateRunner = {
          federationId: federateRunnerConfig.federationId,
          host: federateRunnerConfig.host,
          publicKeys: federateRunnerConfig.publicKeys,
        };

        Runners.hosts.federate = Runners.hosts.federate || federateRunner;
        Runners.hosts.federates = Runners.hosts.federates || [];
        Runners.hosts.federates.push(federateRunner);
      })
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

    await startFederates(
      1, 
      federatesToStart.map(getConfigForFederateNodes), 
    );
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

        process.stdout.write(`\n Starting additional Federate nodes from block ${latestBlock.hash}. Height: ${latestBlock.number} \n\n`);
        return await startFederates(
          federatesToStart.length + 1, 
          config.additionalFederateNodes.map(getConfigForFederateNodes), 
          latestBlock.hash
        );
      };
    }

    process.stdout.write('\n');
  } catch(ex) {
    process.stdout.write(`Error starting federate nodes ${ex.stack} \n`);
    throw new Error(ex.toString());
  }
});

beforeEach(() => {
  expect(Runners.btcRunner == null || Runners.btcRunner.isRunning(), "Bitcoind is not running").to.be.ok;
  expect(Runners.fedRunner == null || Runners.fedRunner.isRunning(), "Federate node is not running").to.be.ok;
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
  } catch(ex) {
    process.stdout.write(`There was a problem starting a Federate. ${ex}\n`);
    throw new Error(ex.toString());
  }
};

const shutdownHooks = () => {
  // Stop bitcoin daemon and federate node(s)
  if (Runners.fedRunners != null) {
    Runners.fedRunners.forEach((fedRunner, index) => {
      fedRunner.stop();
      if (fedRunner.hsm) {
        fedRunner.hsm.stop();
        fedRunner.hsm = null;
      }
    });
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

const needsToBeTested = function(testFile) {
  const testFileName = path.basename(testFile);
  // Order is include, exclude
  if (testCasesInclude != null && testCasesInclude.some(inclusion => testFileName.startsWith(inclusion))) {
    return true;
  }
  if (testCasesExclude != null && testCasesExclude.some(exclusion => testFileName.startsWith(exclusion))) {
    return false;
  }
  return testCasesInclude == null;
}

const runTestThisTimes = process.env.RUN_EACH_TEST_FILE_THESE_TIMES || 1;

// Register tests
glob.sync('./tests/**/*.js')
  .filter(test => needsToBeTested(test))
  .sort()
  .forEach(test => {
    for(let i = 0; i < runTestThisTimes; i++) {
      delete require.cache[require.resolve(test)];
      require(test);
    }
});
