const btcTxHelper = require('btc-transaction-helper');
const BTC_TX_FEE = 0.001;

let btcClient;

const createBtcClient = () => {
    let hostAndPort = Runners.hosts.bitcoin.rpcHost.split(":");
    return new btcTxHelper.BtcTransactionHelper({
        host: hostAndPort[0],
        port: hostAndPort[1],
        user: Runners.hosts.bitcoin.rpcUser,
        pass: Runners.hosts.bitcoin.rpcPassword,
        network: Runners.hosts.bitcoin.network,
        txFee: BTC_TX_FEE
    });
}

const getBtcClient = () => {
    if (!btcClient) {
        btcClient = createBtcClient();
    }

    return btcClient;
}

module.exports = { getBtcClient }
