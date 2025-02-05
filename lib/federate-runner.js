
var childProcess = require('child_process');
var devnull = require('dev-null');
var fs = require('fs-extra');
var tmp = require('tmp');
var portUtils = require('./port-utils');
var path = require('path');
var find = require('find');
var _ = require('lodash');
let removeDir = require('./utils').removeDir;

const javaCommand = process.env.JAVA_BIN_PATH ? process.env.JAVA_BIN_PATH : 'java';

var DEFAULT_OPTIONS = {
  bitcoinPeer: 'localhost:20123',
  command: javaCommand,
  mainClass: 'co.rsk.federate.FederateRunner',
  removeDataDirOnStop: true,
  runnerStdOut: process.stdout,
  forks: {
    activationHeights: null
  }
}

var FederateRunner = function(options) {
  this.options = Object.assign({}, DEFAULT_OPTIONS, options);
}

FederateRunner.prototype.start = function() {
  if (this.isRunning()) {
    throw "Federate already started";
  }

  this.dataDir = this.options.dir || tmp.dirSync().name;

  if (this.options.classpath == null) {
    throw "Must specify a classpath for the Federate";
  }
  this.options.classpath = path.resolve(this.options.classpath);
  var originalFilename = this.options.classpath;

  if (!fs.existsSync(originalFilename)) {
    throw `${originalFilename} does not exist`;
  }

  var filename = fs.realpathSync(originalFilename);
  dir = path.dirname(filename);

  const runnerStdOut = this.options.runnerStdOut;
  find.file(/federate-node.+\-all\.jar$/, dir, function(files) {
    //get the files from simbolic links
    var realFiles = _.map(files, function(file) {
      var stats = fs.lstatSync(file);
      var realFile = file;
      if(stats.isSymbolicLink()){
        realFile = fs.readlinkSync(file);
      }
      return realFile;
    });
    var maxFileName = _.max(realFiles);
    if(maxFileName != null && path.basename(maxFileName) !== path.basename(filename)) {
      runnerStdOut.write("WARNING regtest.js Federate classpath uses " + path.basename(filename) + " but there is a newer version: " + path.basename(maxFileName) + "\n");
    }
  })

  if (this.options.configFile == null) {
    throw "Must specify a configuration file for the Federate";
  }
  this.options.configFile = path.resolve(this.options.configFile);

  var portsNeeded = (!this.options.port ? 1 : 0) + (!this.options.rpcPort ? 1 : 0);
  var futurePorts = portsNeeded === 0 ? Promise.resolve([]) : portUtils.findFreePort(20000, 20100, '127.0.0.1', portsNeeded);

  return futurePorts.then((selectedPorts) => {
    this.ports = {
      rsk: this.options.port,
      rpc: this.options.rpcPort
    }
    var portIndex = 0;
    if (!this.ports.rsk) {
      this.ports.rsk = selectedPorts[portIndex++];
    }
    if (!this.ports.rpc) {
      this.ports.rpc = selectedPorts[portIndex++];
    }

    var customConfig = this.options.customConfig || {};

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
    var args = [
      '-cp', this.options.classpath,
      `-Drsk.conf.file=${this.options.configFile}`
    ]

    Object.keys(customConfig).forEach((key) => {
      args.push(`-D${key}=${customConfig[key]}`)
    });

    if (!this.options.dir) {
      args.push(`-Ddatabase.dir=${this.dataDir}/db`);
      args.push(`-Ddatabase.reset=true`);
    }

    if (this.options.logbackFile) {
      args.push(`-Dlogback.configurationFile=${this.options.logbackFile}`);
    }

    if (this.options.forks.activationHeights) {
      var overrideMessage = [];
      Object.keys(this.options.forks.activationHeights)
        .forEach(key => {
          args.push(`-Dblockchain.config.hardforkActivationHeights.${key}=${this.options.forks.activationHeights[key]}`)
          overrideMessage.push(`${key}=${this.options.forks.activationHeights[key]}`);
        });
      this.options.runnerStdOut.write(` overriding hard fork activation: ${overrideMessage.join(', ')}\n`);
    }

    args.push(this.options.mainClass);
    args.push(`--regtest`);

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
