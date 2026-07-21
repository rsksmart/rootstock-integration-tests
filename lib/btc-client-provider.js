const btcTxHelper = require('@rsksmart/btc-transaction-helper');
const BTC_TX_FEE = 0.001;

// The underlying client defaults to a 30s RPC timeout, which is too short for calls that mine
// many blocks or many outputs in one request (e.g. the initial 400-block bootstrap) on slower
// machines or newer bitcoind versions.
const BTC_RPC_TIMEOUT_IN_MILLISECONDS = 120000;

let btcClient;

const createBtcClient = () => {
    let hostAndPort = Runners.hosts.bitcoin.rpcHost.split(':');
    return new btcTxHelper.BtcTransactionHelper({
        host: hostAndPort[0],
        port: Number(hostAndPort[1]),
        user: Runners.hosts.bitcoin.rpcUser,
        pass: Runners.hosts.bitcoin.rpcPassword,
        network: Runners.hosts.bitcoin.network,
        txFee: BTC_TX_FEE,
        timeout: BTC_RPC_TIMEOUT_IN_MILLISECONDS,
    });
};

const getBtcClient = () => {
    if (!btcClient) {
        btcClient = createBtcClient();
    }

    return btcClient;
};

module.exports = { getBtcClient };
