var childProcess = require('node:child_process');
var tmp = require('tmp');
var devnull = require('dev-null');
var portUtils = require('./port-utils');
let removeDir = require('./utils').removeDir;
const { BtcTransactionHelper } = require('@rsksmart/btc-transaction-helper');

// RPC_IN_WARMUP: bitcoind is up but still loading the block index/wallets and rejects RPC calls meanwhile.
const RPC_IN_WARMUP = -28;
const isRetryableStartupError = (err) => {
    if (!err) {
        return false;
    }
    // The RPC client surfaces bitcoind's JSON-RPC error code as `err.code`, but fall back to a
    // possibly nested `err.error.code` in case a different RPC client shape is used in the future.
    const code = err.code != null ? err.code : err.error && err.error.code;
    return code === 'ECONNREFUSED' || code === RPC_IN_WARMUP;
};

// The RPC port can accept TCP connections slightly before bitcoind's JSON-RPC server is ready to respond,
// so poll a cheap read-only call until it succeeds. Only connection-refused/warmup errors are retried here;
// any other error (e.g. a real RPC failure) is surfaced immediately instead of being retried blindly.
function waitUntilRpcReady(btcTxHelper, retriesLeft) {
    retriesLeft = retriesLeft == null ? 20 : retriesLeft;
    return btcTxHelper.getLatestBlockNumber().catch((err) => {
        if (!isRetryableStartupError(err) || retriesLeft <= 0) {
            throw err;
        }
        return new Promise((resolve) => setTimeout(resolve, 500)).then(() =>
            waitUntilRpcReady(btcTxHelper, retriesLeft - 1)
        );
    });
}

const bitcoinCommand = process.env.BITCOIND_BIN_PATH ? process.env.BITCOIND_BIN_PATH : 'bitcoind';

var DEFAULT_OPTIONS = {
    command: bitcoinCommand,
    args: [
        '-regtest',
        '-printtoconsole',
        '-bind=127.0.0.1',
        '-rpcbind=127.0.0.1',
        '-txindex',
        '-fallbackfee=0.0002',
        '-deprecatedrpc=signrawtransaction',
        '-deprecatedrpc=generate',
    ],
    port: null, // null => select a random port
    rpcPort: null, // null => select a random port
    rpcUser: 'rsk',
    rpcPassword: 'rsk',
    removeDataDirOnStop: true,
};

var BitcoinRunner = function (options) {
    this.options = Object.assign({}, DEFAULT_OPTIONS, options);
};

BitcoinRunner.prototype.start = function () {
    if (this.isRunning()) {
        throw 'Bitcoind already started';
    }

    this.dataDir = this.options.dir || tmp.dirSync().name;

    var portsNeeded = (!this.options.port ? 1 : 0) + (!this.options.rpcPort ? 1 : 0);
    var futurePorts =
        portsNeeded === 0
            ? Promise.resolve([])
            : portUtils.findFreePorts(20000, 20100, portsNeeded, '127.0.0.1');

    return futurePorts.then((selectedPorts) => {
        this.ports = {
            btc: this.options.port,
            rpc: this.options.rpcPort,
        };
        var portIndex = 0;
        if (!this.ports.btc) {
            this.ports.btc = selectedPorts[portIndex++];
        }
        if (!this.ports.rpc) {
            this.ports.rpc = selectedPorts[portIndex];
        }

        var args = this.options.args.concat([
            `-port=${this.ports.btc}`,
            `-rpcport=${this.ports.rpc}`,
            `-rpcuser=${this.options.rpcUser}`,
            `-rpcpassword=${this.options.rpcPassword}`,
            `-datadir=${this.dataDir}`,
        ]);

        this.process = childProcess.spawn(this.options.command, args, {
            cwd: this.dataDir,
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

        return portUtils
            .waitForPorts(
                [
                    {
                        host: '127.0.0.1',
                        port: this.ports.btc,
                    },
                    {
                        host: '127.0.0.1',
                        port: this.ports.rpc,
                    },
                ],
                {
                    numRetries: 100,
                    retryInterval: 1000,
                }
            )
            .then((r) => {
                const btcTxHelper = new BtcTransactionHelper({
                    host: '127.0.0.1',
                    port: Number(this.ports.rpc),
                    user: this.options.rpcUser,
                    pass: this.options.rpcPassword,
                });
                return waitUntilRpcReady(btcTxHelper)
                    .then(() => btcTxHelper.createWallet())
                    .then(() => {
                        this.running = true;
                        return r;
                    });
            });
    });
};

BitcoinRunner.prototype.stop = function () {
    if (this.process == null) {
        throw 'Bitcoind was not started';
    }

    this.process.kill();

    if (this.options.removeDataDirOnStop) {
        removeDir(this.dataDir);
    }
};

BitcoinRunner.prototype.getDataDir = function () {
    return this.dataDir;
};

BitcoinRunner.prototype.isRunning = function () {
    return this.running;
};

BitcoinRunner.prototype.getPid = function () {
    if (!this.isRunning()) {
        return false;
    }

    return this.process.pid;
};

module.exports = {
    Runner: BitcoinRunner,
};
