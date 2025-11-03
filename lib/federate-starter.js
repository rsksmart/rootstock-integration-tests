const colors = require('colors/safe');
const LineWrapper = require('stream-line-wrapper');
const FederateRunner = require('./federate-runner').Runner;
const { KEY_TYPE_BTC, KEY_TYPE_RSK, KEY_TYPE_MST } = require('./constants/federation-constants');
const { compressPublicKey, waitForSync } = require('./rsk-utils');
const TcpSignerRunner = require('../lib/tcpsigner-runner');
const { expect } = require('chai');
const { getRskTransactionHelpers } = require('./rsk-tx-helper-provider');
const fs = require('node:fs');
const path = require('node:path');

const FEDERATE_OUTPUT = 'federator-{index}:';
const FEDERATE_COLORS = [
    colors.blue,
    colors.cyan,
    colors.magenta,
    colors.red,
    colors.yellow,
].map(f => f.bind(colors));
  
const HOST = '127.0.0.1';

process.stdout.setMaxListeners(24);
process.stderr.setMaxListeners(24);

const getFederateOutputPrefix = function(index, label) {
    const color = FEDERATE_COLORS[(index) % FEDERATE_COLORS.length];
    return color(FEDERATE_OUTPUT.replace('{index}', `${index}-${label}`));
};
  
const parseActivations = (forks) => {
    activations = { activationHeights: {} };
    for (let fork in forks) {
        activations.activationHeights[fork] = forks[fork].activationHeight;
    }
    return activations;
};

const createLogbackFileIfNotExists = (logbackConfigFilePath, index) => {
    const logbackFileDir = path.dirname(logbackConfigFilePath);
    const baseLogbackFilePath = path.resolve(__dirname, '../config/base-logback-config.xml');
    const logFileName = `fed${index}.log`;
    const logFilePath = path.join(logbackFileDir, logFileName);
  
    try {
      fs.mkdirSync(logbackFileDir, { recursive: true });
  
      const fd = fs.openSync(logbackConfigFilePath, 'wx');
  
      const baseContent = fs.readFileSync(baseLogbackFilePath, 'utf8');
  
      const updatedContent = baseContent
        .replace(/<file>.*<\/file>/, `<file>${logFilePath}</file>`)
        .replace(
          /<fileNamePattern>.*<\/fileNamePattern>/,
          `<fileNamePattern>${logbackConfigFilePath}/rskj-%d{yyyy-MM-dd}.%i.log.gz</fileNamePattern>`
        );
  
      fs.writeSync(fd, updatedContent, null, 'utf8');
      fs.closeSync(fd);
  
    } catch (err) {
      if (err.code === 'EEXIST') {
        // File already exists, nothing to do
      } else {
        console.error('Error creating logback file:', err.message);
      }
    }
  };

const startFederate = async (index, fedConfig, blockHashCheckpoint, bookkeepingConfigurations) => {

    bookkeepingConfigurations = fedConfig.bookkeepingConfigurations || bookkeepingConfigurations;

    const federateOutputPrefix = getFederateOutputPrefix(index, fedConfig.federationId);
    const fedStderr = new LineWrapper({ prefix: federateOutputPrefix });
    fedStderr.pipe(process.stderr);

    const federateConfig = {
        ...fedConfig,
        stderr: fedStderr,
        logbackFile: fedConfig.logbackFile,
        forks: parseActivations(Runners.common.forks),
    };

    federateConfig.customConfig['miner.client.enabled'] = false;
    federateConfig.customConfig['federator.updateBridgeTimerEnabled'] = false;
    // Override bookkeeping fedConfig for all the feds regardless if they use HSM2 or not
    federateConfig.customConfig['federator.signers.BTC.bookkeeping.difficultyTarget'] = bookkeepingConfigurations.difficultyTarget;
    federateConfig.customConfig['federator.signers.BTC.bookkeeping.informerInterval'] = bookkeepingConfigurations.informerInterval;
    federateConfig.customConfig['federator.signers.BTC.bookkeeping.maxAmountBlockHeaders'] = bookkeepingConfigurations.maxAmountBlockHeaders;
    federateConfig.customConfig['federator.signers.BTC.bookkeeping.maxChunkSizeToHsm'] = bookkeepingConfigurations.maxChunkSizeToHsm;

    const fedStdout = new LineWrapper({ prefix: federateOutputPrefix });
    fedStdout.pipe(process.stdout);
    if (federateConfig.printOutput) {
        federateConfig.stdout = fedStdout;
    }
    federateConfig.runnerStdOut = fedStdout;

    federateConfig.bitcoinPeer = Runners.hosts.bitcoin.peerHost;

    createLogbackFileIfNotExists(federateConfig.logbackFile, index);

    try {

        const fedRunner = new FederateRunner(federateConfig);
        Runners.hosts.federates = Runners.hosts.federates || [];

        fedRunner.hsm = null;

        if(fedConfig.type === 'hsm') {
            const hsmPort = fedConfig.hsmPort;
            const difficultyTarget = fedConfig.hsmDifficultyTarget;
            const hsm = new TcpSignerRunner(fedConfig.id, hsmPort, [`-c${blockHashCheckpoint}`, `--difficulty=${difficultyTarget}`]);
            await hsm.start();
            const publicKeysFromTcpSigner = await hsm.getPublicKeys();
            const compressedPublicKeys = publicKeysFromTcpSigner.map((pubKey) => {
                return compressPublicKey(pubKey);
            });
            expect(compressedPublicKeys).to.be.deep.equal(Object.values(fedConfig.publicKeys), `HSM ${fedConfig.id} public keys do not match the expected ones`);
            fedRunner.hsm = hsm;
        }

        Runners.fedRunners = Runners.fedRunners || [];
        Runners.fedRunners.push(fedRunner);

        await fedRunner.start({
            port: fedConfig.port,
            rpcPort: fedConfig.rpcPort,
        });

        const host = {
            federationId: fedConfig.federationId,
            host: `${HOST}:${fedRunner.ports.rpc}`,
            publicKeys: fedConfig.publicKeys,
        }

        Runners.hosts.federates.push(host);
        Runners.hosts.federate = Runners.hosts.federate || host;
        fedStdout.write(
` Started on
    - p2p port:    ${fedRunner.ports.rsk}
    - rpc port:    ${fedRunner.ports.rpc}
    - directory:   ${fedRunner.getDataDir()}
    - process ID:  ${fedRunner.getPid()}
    - BTC pub key: ${host.publicKeys[KEY_TYPE_BTC]}
    - RSK pub key: ${host.publicKeys[KEY_TYPE_RSK]}
    - MST pub key: ${host.publicKeys[KEY_TYPE_MST]}\n`);
    } catch(ex) {
        fedStdout.write(`${ex.stack} \n`);
        throw new Error(ex.toString());
    }
};

module.exports = {
    startFederate: startFederate,
    createLogbackFileIfNotExists,
};