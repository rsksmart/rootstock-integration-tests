var colors = require('colors/safe');
var LineWrapper = require('stream-line-wrapper');

var { executeWithRetries } = require('./utils');
var HsmRunner = require('./hsm-runner').Runner;
var FederateRunner = require('./federate-runner').Runner;
const { KEY_TYPES, KEY_TYPE_BTC, KEY_TYPE_RSK, KEY_TYPE_MST } = require('./constants');

var FEDERATE_OUTPUT = 'federate-{index}:';
var FEDERATE_COLORS = [
    colors.blue,
    colors.cyan,
    colors.magenta,
    colors.red,
    colors.yellow,
].map(f => f.bind(colors));
var HSM_OUTPUT = 'hsm-{index}-{keyType}:';
var HSM_COLORS = [
    colors.blue,
    colors.cyan,
    colors.magenta,
    colors.red,
    colors.yellow
].map(f => f.bind(colors));

const DEFAULT_SIGNER_PATHS = {
    [KEY_TYPE_BTC]: "m/44'/1'/0'/0/0",
    [KEY_TYPE_RSK]: "m/44'/1'/0'/0/1",
    [KEY_TYPE_MST]: "m/44'/1'/0'/0/2",
};
  
const HOST = '127.0.0.1';
const HSM_HOST = '127.0.0.1';

var getFederateOutputPrefix = function(index) {
    var color = FEDERATE_COLORS[(index) % FEDERATE_COLORS.length];
    return color(`${FEDERATE_OUTPUT.replace('{index}', index)}`);
};
  
var getHsmOutputPrefix = function(index, keyType) {
    var color = HSM_COLORS[(index) % HSM_COLORS.length];
    return colors.bold(color(`${HSM_OUTPUT.replace('{index}', index).replace('{keyType}', keyType)}`));
};

const startHsm = async (config, hsmOutputPrefix, stderr, stdout, keyId, latestBlockHash, difficultyTarget) => {
    var hsmStdout;
    var hsmStderr;
    if (config.printOutput) {
        hsmStdout = new LineWrapper({ prefix: hsmOutputPrefix });
        hsmStdout.pipe(stdout);
        hsmStderr = new LineWrapper({ prefix: hsmOutputPrefix });
        hsmStderr.pipe(stderr);
    }
    var hsmRunner = new HsmRunner({
        version: config.version,
        useDocker: config.useDocker,
        command: config.command,
        serverPath: config.serverPath,
        keyPath: config.keyPath,
        seedPath: config.seedPath,
        port: config.port,
        stdout: hsmStdout,
        stderr: hsmStderr,
        keyId: keyId,
        forks: Runners.common.forks,
        latestBlockHash: latestBlockHash,
        difficultyTarget: difficultyTarget,
        useLogger: config.useLogger
    });
    try {
        await hsmRunner.start()
        process.stdout.write(`${hsmOutputPrefix} HSM ${hsmRunner.options.version} started on port ${hsmRunner.port} (PID: ${hsmRunner.getPid()}) \n`);
        return hsmRunner;
    } catch(ex) {
        process.stdout.write(`${hsmOutputPrefix} ${ex.stack} \n`);
        throw new Error(ex.toString());
    }
};

const startFederate = async (index, config, stderr, stdout, runners, logbackFile, latestBlockHash, bookkeepingConfigurations) => {
    const federateOutputPrefix = getFederateOutputPrefix(index);
    const fedStderr = new LineWrapper({ prefix: federateOutputPrefix });
    fedStderr.pipe(stderr);

    const parseActivations = (forks) => {
        activations = { activationHeights: {} };
        for (let fork in forks) {
            activations.activationHeights[fork] = forks[fork].activationHeight;
        }
        return activations;
    };

    const federateConfig = Object.assign({}, config, {
        stderr: fedStderr,
        logbackFile: config.logbackFile ? config.logbackFile : logbackFile,
        forks: parseActivations(Runners.common.forks)
    });

    federateConfig.customConfig['miner.client.enabled'] = false;
    federateConfig.customConfig['federator.updateBridgeTimerEnabled'] = false;
    // Override bookkeeping config for all the feds regardless if they use HSM2 or not
    federateConfig.customConfig['federator.signers.BTC.bookkeeping.difficultyTarget'] = bookkeepingConfigurations.difficultyTarget;
    federateConfig.customConfig['federator.signers.BTC.bookkeeping.informerInterval'] = bookkeepingConfigurations.informerIntervalInMs;
    federateConfig.customConfig['federator.signers.BTC.bookkeeping.maxAmountBlockHeaders'] = bookkeepingConfigurations.blockHeadersToSend;

    const fedStdout = new LineWrapper({ prefix: federateOutputPrefix });
    fedStdout.pipe(stdout);
    if (federateConfig.printOutput) {
        federateConfig.stdout = fedStdout;
    }
    federateConfig.runnerStdOut = fedStdout;

    federateConfig.bitcoinPeer = Runners.hosts.bitcoin.peerHost;

    try {
        // Start an HSM instance for each key type specified
        const hsms = {};
        const publicKeys = {};
        for (let keyType of KEY_TYPES) {
            if (config.hsmConfigs != null && config.hsmConfigs[keyType] != null) {

                if(config.hsmConfigs && config.hsmConfigs.bookkeepingConfigurations) {
                    federateConfig.customConfig['federator.signers.BTC.bookkeeping.difficultyTarget'] = config.hsmConfigs.bookkeepingConfigurations.difficultyTarget;
                    federateConfig.customConfig['federator.signers.BTC.bookkeeping.informerInterval'] = config.hsmConfigs.bookkeepingConfigurations.informerIntervalInMs;
                    federateConfig.customConfig['federator.signers.BTC.bookkeeping.maxAmountBlockHeaders'] = config.hsmConfigs.bookkeepingConfigurations.blockHeadersToSend;
                    federateConfig.customConfig['federator.signers.BTC.bookkeeping.maxChunkSizeToHsm'] = config.hsmConfigs.bookkeepingConfigurations.maxChunkSizeToHsm;
                }

                const hsm = await startHsm(
                    config.hsmConfigs[keyType],
                    getHsmOutputPrefix(index, keyType),
                    stderr,
                    stdout,
                    config.hsmConfigs[keyType].keyId || DEFAULT_SIGNER_PATHS[keyType],
                    latestBlockHash,
                    bookkeepingConfigurations.difficultyTarget
                );
                const signerId = keyType.toUpperCase();

                // Override signers config
                federateConfig.customConfig[`federator.signers.${signerId}.type`] = 'hsm';
                federateConfig.customConfig[`federator.signers.${signerId}.host`] = HSM_HOST;
                federateConfig.customConfig[`federator.signers.${signerId}.port`] = hsm.port;

                // Set the key id, which might be overriden by configuration
                const keyId = hsm.getKeyId();
                federateConfig.customConfig[`federator.signers.${signerId}.keyId`] = keyId;

                // Gather the bitcoin public key from the hsm
                try {
                    publicKeys[keyType] = await executeWithRetries(
                        () => hsm.getPublicKey(keyId),
                        3,
                        1000
                    );
                }
                catch (ex) {
                    const hsmGenericStdOut = new LineWrapper({ prefix: getHsmOutputPrefix(index, 'undetermined') });
                    hsmGenericStdOut.pipe(stdout);
                    hsmGenericStdOut.write(`${ex.toString()} ${ex.stack ? ex.stack : ''} \n`);
                    throw new Error(ex.toString());
                }

                hsms[keyType] = hsm;
            } else {
                // Gather public key from configuration for now.
                // TODO: actually read the node's configuration file,
                // read the key file and compute the public key
                publicKeys[keyType] = config.publicKeys[keyType];
            }
        }

        const fedRunner = new FederateRunner(federateConfig);
        fedRunner.hsms = hsms;
        runners.fedRunners = runners.fedRunners || [];
        runners.fedRunners.push(fedRunner);

        await fedRunner.start();
        
        const host = {
            host: `${HOST}:${fedRunner.ports.rpc}`,
            publicKeys: publicKeys,
        };

        runners.hosts.federates = runners.hosts.federates || [];
        runners.hosts.federates.push(host);
        runners.hosts.federate = runners.hosts.federate || host;
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
    startFederate: startFederate
};