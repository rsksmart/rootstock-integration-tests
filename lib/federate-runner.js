
const childProcess = require('node:child_process');
const devnull = require('dev-null');
const fs = require('fs-extra');
const tmp = require('tmp');
const portUtils = require('./port-utils');
const path = require('node:path');
const find = require('find');
const _ = require('lodash');
const removeDir = require('./utils').removeDir;

const javaCommand = process.env.JAVA_BIN_PATH ? process.env.JAVA_BIN_PATH : 'java';

const DEFAULT_OPTIONS = {
  bitcoinPeer: 'localhost:20123',
  command: javaCommand,
  mainClass: 'co.rsk.federate.FederateRunner',
  removeDataDirOnStop: true,
  runnerStdOut: process.stdout,
  forks: {
    activationHeights: null
  }
}

const FederateRunner = function(options) {
  this.options = Object.assign({}, DEFAULT_OPTIONS, options);
}

FederateRunner.prototype._assignPorts = function(selectedPorts) {
  this.ports = {
    rsk: this.options.port,
    rpc: this.options.rpcPort
  };
  let portIndex = 0;
  if (!this.ports.rsk) {
    this.ports.rsk = selectedPorts[portIndex++];
  }
  if (!this.ports.rpc) {
    this.ports.rpc = selectedPorts[portIndex++];
  }
};

FederateRunner.prototype._setupCustomConfig = function() {
  const customConfig = this.options.customConfig || {};

  if (this.options.bitcoinPeer && this.options.customConfig['federator.bitcoinPeerAddresses.0'] == null) {
    this.options.customConfig['federator.bitcoinPeerAddresses.0'] = this.options.bitcoinPeer;
  }

  // Port override
  if (this.options.customConfig['peer.port'] == null) {
    this.options.customConfig['peer.port'] = this.ports.rsk;
  }

  if (this.options.customConfig['rpc.providers.web.http.port'] == null) {
    this.options.customConfig['rpc.providers.web.http.port'] = this.ports.rpc;
  }
  
  return customConfig;
};

FederateRunner.prototype._buildArguments = function(customConfig) {
  const args = [
    '-cp', this.options.classpath,
    `-Drsk.conf.file=${this.options.configFile}`
  ];

  const argumentsKeys = Object.keys(customConfig);
  for (const key of argumentsKeys) {
    args.push(`-D${key}=${customConfig[key]}`)
  }

  if (!this.options.dir) {
    args.push(`-Ddatabase.dir=${this.dataDir}/db`);
    args.push(`-Ddatabase.reset=true`);
  }

  if (this.options.logbackFile) {
    args.push(`-Dlogback.configurationFile=${this.options.logbackFile}`);
  }

  if (this.options.forks.activationHeights) {
    const overrideMessage = [];
    const activationHeightsKeys = Object.keys(this.options.forks.activationHeights);
    for (const key of activationHeightsKeys) {
      args.push(`-Dblockchain.config.hardforkActivationHeights.${key}=${this.options.forks.activationHeights[key]}`)
      overrideMessage.push(`${key}=${this.options.forks.activationHeights[key]}`);
    }
    this.options.runnerStdOut.write(` overriding hard fork activation: ${overrideMessage.join(', ')}\n`);
  }

  args.push(this.options.mainClass);
  args.push(`--regtest`);
  
  return args;
};

FederateRunner.prototype._setupProcess = function(args) {
  this.process = childProcess.spawn(this.options.command, args, {
    cwd: this.dataDir
  });

  if (this.options.stdout != null) {
    this.process.stdout.pipe(this.options.stdout);
  } else {
    this.process.stdout.pipe(devnull());
  }

  if (this.options.stderr != null) {
    this.process.stderr.pipe(this.options.stderr);
  } else {
    this.process.stderr.pipe(devnull());
  }

  this.running = false;

  this.process.on('exit', () => {
    this.running = false;
  });
};

FederateRunner.prototype.start = function() {
  if (this.isRunning()) {
    throw "Federate already started";
  }

  this.dataDir = this.options.dir || tmp.dirSync().name;

  if (this.options.classpath == null) {
    throw "Must specify a classpath for the Federate";
  }
  this.options.classpath = path.resolve(this.options.classpath);
  const originalFilename = this.options.classpath;

  if (!fs.existsSync(originalFilename)) {
    throw `${originalFilename} does not exist`;
  }

  const filename = fs.realpathSync(originalFilename);
  dir = path.dirname(filename);

  const runnerStdOut = this.options.runnerStdOut;
  find.file(/federate-node.+\-all\.jar$/, dir, function(files) {
    //get the files from simbolic links
    const realFiles = _.map(files, function(file) {
      const stats = fs.lstatSync(file);
      let realFile = file;
      if(stats.isSymbolicLink()){
        realFile = fs.readlinkSync(file);
      }
      return realFile;
    });
    const maxFileName = _.max(realFiles);
    if(maxFileName != null && path.basename(maxFileName) !== path.basename(filename)) {
      runnerStdOut.write("WARNING Federate classpath uses " + path.basename(filename) + " but there is a newer version: " + path.basename(maxFileName) + "\n");
    }
  })

  if (this.options.configFile == null) {
    throw "Must specify a configuration file for the Federate";
  }
  this.options.configFile = path.resolve(this.options.configFile);

  const portsNeeded = (this.options.port ? 0 : 1) + (this.options.rpcPort ? 0 : 1);
  const futurePorts = portsNeeded === 0 ? Promise.resolve([]) : portUtils.findFreePort(20000, 20100, '127.0.0.1', portsNeeded);

  return futurePorts.then((selectedPorts) => {
    this._assignPorts(selectedPorts);
    const customConfig = this._setupCustomConfig();
    const args = this._buildArguments(customConfig);
    this._setupProcess(args);

    runnerStdOut.write(` starting!\n`);

    return portUtils.waitForPorts([{
      host: '127.0.0.1',
      port: this.ports.rsk
    }, {
      host: '127.0.0.1',
      port: this.ports.rpc
    }], {
      numRetries: 100,
      retryInterval: 1000
    }).then((r) => {
      this.running = true;
      return r;
    }).catch((ex) => {
      this.running = false;
      throw new Error("federate-runner " + ex.toString());
    });
  });
};

FederateRunner.prototype.stop = function() {
  if  (this.process == null) {
    throw "Federate was not started";
  }

  // We send a SIGKILL instead of a regular SIGTERM
  // since the Federator doesn't yet handle
  // SIGTERM consistently

  this.process.kill('SIGKILL');

  if(this.hsm) {
    this.hsm.stop();
    this.hsm = null;
  }

  if (this.options.removeDataDirOnStop) {
    removeDir(this.dataDir);
  }


};

FederateRunner.prototype.getDataDir = function() {
  return this.dataDir;
};

FederateRunner.prototype.isRunning = function() {
  return this.running;
};

FederateRunner.prototype.getPid = function() {
  if (!this.isRunning()) {
    return false;
  }

  return this.process.pid;
}

module.exports = {
  Runner: FederateRunner
};
