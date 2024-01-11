const expect = require('chai').expect;
const rsk = require('peglib').rsk;
const rskUtilsLegacy = require('./rsk-utils-legacy');

const sendTxToBridgeWithoutMining = (rskClient) => async (senderAddress, valueInWeis) => {

    return new Promise((resolve, reject) => {
        const sendResult = rskClient.eth.sendTransaction({
            from: senderAddress,
            to: rsk.getBridgeAddress(),
            value: valueInWeis,
            gasPrice: 2
        });

        sendResult.catch((err) => reject(err));
        sendResult.once('transactionHash', (txHash) => {
            resolve(txHash);
        });
    })
}

const createPegoutRequest = async (rskClient, pegClient, amountInRBTC, requestSize = 1) => {
    const AMOUNT_IN_WEIS = rsk.btcToWeis(amountInRBTC);
    const RSK_TX_FEE_IN_WEIS = rsk.btcToWeis(1);
    const PEGOUT_AMOUNT_PLUS_FEE = (AMOUNT_IN_WEIS + RSK_TX_FEE_IN_WEIS) * requestSize;

    const addresses = await pegClient.generateNewAddress('test');
    expect(addresses.inRSK).to.be.true;
    const utils = rskUtilsLegacy.with(null, rskClient, null);
    await utils.sendFromCow(addresses.rsk, PEGOUT_AMOUNT_PLUS_FEE);
    await rskClient.eth.personal.unlockAccount(addresses.rsk, '');

    const sendTxToBridgeFunction = sendTxToBridgeWithoutMining(rskClient);
    for (let i = 0; i < requestSize; i++) {
        await sendTxToBridgeFunction(addresses.rsk, AMOUNT_IN_WEIS);
    }
    await rskClient.evm.mine()
}

module.exports = {
    with: (btcClient, rskClient) => ({
    }),
    createPegoutRequest,
};
