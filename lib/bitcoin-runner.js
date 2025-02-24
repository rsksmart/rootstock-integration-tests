var childProcess = require('child_process');
var tmp = require('tmp');
var devnull = require('dev-null');
var portUtils = require('./port-utils');
let removeDir = require('./utils').removeDir;

const bitcoinCommand = process.env.BITCOIND_BIN_PATH ? process.env.BITCOIND_BIN_PATH : 'bitcoind';

var DEFAULT_OPTIONS = {
  command: bitcoinCommand,
  args: [
    '-regtest',
    '-printtoconsole',
    '-bind=127.0.0.1',
    '-rpcbind=127.0.0.1',
    '-txindex',
    '-deprecatedrpc=signrawtransaction',
    '-deprecatedrpc=generate'
  ],
  port: null, // null => select a random port
  rpcPort: null, // null => select a random port
  rpcUser: 'rsk',
  rpcPassword: 'rsk',
  removeDataDirOnStop: true
}

var BitcoinRunner = function(options) {
  this.options = Object.assign({}, DEFAULT_OPTIONS, options);
};

BitcoinRunner.prototype.start = function() {
  if (this.isRunning()) {
    throw "Bitcoind already started";
  }

  this.dataDir = this.options.dir || tmp.dirSync().name;

  var portsNeeded = (!this.options.port ? 1 : 0) + (!this.options.rpcPort ? 1 : 0);
  var futurePorts = portsNeeded === 0 ? Promise.resolve([]) : portUtils.findFreePorts(20000, 20100, portsNeeded, '127.0.0.1');

  return futurePorts.then((selectedPorts) => {
    this.ports = {
      btc: this.options.port,
      rpc: this.options.rpcPort
    }
    var portIndex = 0;
    if (!this.ports.btc) {
      this.ports.btc = selectedPorts[portIndex++];
    }
    if (!this.ports.rpc) {
      this.ports.rpc = selectedPorts[portIndex++];
    }

    var args = this.options.args.concat([
      `-port=${this.ports.btc}`,
      `-rpcport=${this.ports.rpc}`,
      `-rpcuser=${this.options.rpcUser}`,
      `-rpcpassword=${this.options.rpcPassword}`,
      `-datadir=${this.dataDir}`
    ]);

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

    return portUtils.waitForPorts([{
      host: '127.0.0.1',
      port: this.ports.btc
    }, {
      host: '127.0.0.1',
      port: this.ports.rpc
    }],
    {
      numRetries: 100,
      retryInterval: 1000
    }).then((r) => {
      this.running = true;
      return r;
    });
  })
};

BitcoinRunner.prototype.stop = function() {
  if  (this.process == null) {
    throw "Bitcoind was not started";
  }

  this.process.kill();

  if (this.options.removeDataDirOnStop) {
    removeDir(this.dataDir);
  }
};

BitcoinRunner.prototype.getDataDir = function() {
  return this.dataDir;
};

BitcoinRunner.prototype.isRunning = function() {
  return this.running;
};

BitcoinRunner.prototype.getPid = function() {
  if (!this.isRunning()) {
    return false;
  }

  return this.process.pid;
}

module.exports = {
  Runner: BitcoinRunner
};
