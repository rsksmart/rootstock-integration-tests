require('dotenv').config();
const glob = require('glob');
const colors = require('colors/safe');
const LineWrapper = require('stream-line-wrapper');
const expect = require('chai').expect;
const path = require('path');

const BitcoinRunner = require('./lib/bitcoin-runner').Runner;
const portUtils = require('./lib/port-utils');

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
const configFileName = process.env.NODE_ENV || 'regtest';
const config = require(`./config/${configFileName}`);

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
  difficultyTarget: 3,
  informerIntervalInMs: 2000,
  blockHeadersToSend: 27
};

// ***** GLOBALS ***** //
global.Runners = {
  hosts: {},
  common: {
    forks: {
      orchid: 1,
      wasabi100: 1,
      papyrus200: 1,
      iris300: 1,
      hop400: 1,
      hop401: 1,
      fingerroot500: 1,
      arrowhead600: 1,
      arrowhead631: 1,
      lovell700: -1,
    },
    additionalFederationAddresses: []
  }
};

function validateBitcoinRunnerConfig(bitcoinConf, configs){
  configs.forEach(function(config){
    if(!bitcoinConf[config]) {
      process.stdout.write(`NO runnersConfig.bitcoin.${config} defined on regtest.js\n`);
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
          host: federateRunnerConfig.host,
          publicKeys: federateRunnerConfig.publicKeys,
        };

        Runners.hosts.federate = Runners.hosts.federate || federateRunner;
        Runners.hosts.federates = Runners.hosts.federates || [];
        Runners.hosts.federates.push(federateRunner);
      })
    }

    // Start desired federates
    const federatesToStart = Array.isArray(config.federate) ? config.federate : [config.federate];
    const additionalFederateNodes = config.additionalFederateNodes ? config.additionalFederateNodes : [];
    const totalAmountOfFederateNodesToStart = federatesToStart.length + additionalFederateNodes.length;
    // Find random ports for all federates
    selectedPorts = await portUtils.findFreePorts(30000, 30100, totalAmountOfFederateNodesToStart * 2, HOST);
    // Configure the ports and peers for each federate
    let assignedFedConfigIndex = 0;
    const getConfigForFederateNodes = (federateToStart) => {
      // Configure ports
      var config = {
        ...federateToStart,
        port: selectedPorts[assignedFedConfigIndex*2],
        rpcPort: selectedPorts[assignedFedConfigIndex*2+1]
      };
      if (!config.customConfig) {
        config.customConfig = {};
      }
      // Set amountOfHeadersToSend to 500 to avoid having to inform headers in separated calls
      config.customConfig[`federator.amountOfHeadersToSend`] = 500;

      // federatesToStart: [1, 2, 3]
      // additionalFederateNodes: [4, 5]
      // Configure peers
      let peerIndex = 0;
      for (let i = 0; i < federatesToStart.length; i++) {
        if (federatesToStart[i] !== federateToStart) {
          config.customConfig[`peer.active.${peerIndex}.ip`] = '127.0.0.1';
          config.customConfig[`peer.active.${peerIndex}.port`] = selectedPorts[i*2];
          config.customConfig[`peer.active.${peerIndex}.nodeId`] = federatesToStart[i].nodeId;
          peerIndex++;
        }
      }
      for (let i = federatesToStart.length; i < federatesToStart.length + additionalFederateNodes.length; i++) {
        const realIdx = i - federatesToStart.length;
        if (additionalFederateNodes[realIdx] !== federateToStart) {
          config.customConfig[`peer.active.${peerIndex}.ip`] = '127.0.0.1';
          config.customConfig[`peer.active.${peerIndex}.port`] = selectedPorts[realIdx*2];
          config.customConfig[`peer.active.${peerIndex}.nodeId`] = additionalFederateNodes[realIdx].nodeId;
          peerIndex++;
        }
      }
      // Configure any manually started federate node as a peer too
      (runnersConfig.federates || []).forEach((federateRunnerConfig) => {
        const parts = federateRunnerConfig.host.split(':');
        config.customConfig[`peer.active.${peerIndex}.ip`] = parts[0];
        config.customConfig[`peer.active.${peerIndex}.port`] = parts[1];
        config.customConfig[`peer.active.${peerIndex}.nodeId`] = federateRunnerConfig.nodeId;
        peerIndex++;
      });
      assignedFedConfigIndex++;
      return config;
    };

    await startFederates(
      1, 
      federatesToStart.map(getConfigForFederateNodes), 
      process.stderr, 
      process.stdout, 
      Runners, 
      initConfig.federatesLogbackFile
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
        return startFederates(
          federatesToStart.length + 1, 
          config.additionalFederateNodes.map(getConfigForFederateNodes), 
          process.stderr, 
          process.stdout, 
          Runners, 
          initConfig.federatesLogbackFile, 
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

const startFederates = async (fedIndexStartsAt, configs, stderr, stdout, runners, logbackFile, latestBlockHash) => {
  if (configs.length === 0) {
    return Promise.resolve();
  }

  try {
    for (let i = 0; i < configs.length; i++) {
      await federateStarter.startFederate(
        fedIndexStartsAt + i, 
        configs[i], 
        stderr, 
        stdout, 
        runners, 
        logbackFile, 
        latestBlockHash, 
        bookkeepingConfigurations
      );
    }
  } catch(ex) {
    stdout.write(`There was a problem starting a Federate. ${ex}\n`);
    throw new Error(ex.toString());
  }
};

const shutdownHooks = () => {
  // Stop bitcoin daemon and federate node(s)
  if (Runners.fedRunners != null) {
    Runners.fedRunners.forEach((fedRunner, index) => {
      fedRunner.stop();
      // process.stdout.write(`${getFederateOutputPrefix(index)} stopped\n`);
      if (fedRunner.hsms) {
        for (const hsm in fedRunner.hsms) {
          fedRunner.hsms[hsm].stop();
          // process.stdout.write(`${getHsmOutputPrefix(index, hsm)} stopped\n`);
        }
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
      require(test)
    }
});
