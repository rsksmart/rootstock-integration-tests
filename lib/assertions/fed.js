const expect = require('chai').expect;
var { wait } = require('../utils');
var bitcoin = require('peglib').bitcoin;
var rsk = require('peglib').rsk;
const rskUtilsLegacy = require('../rsk-utils-legacy');
const { getBridge } = require('../bridge-provider');
const rskUtils = require('../rsk-utils');
const { getRskTransactionHelpers } = require('../rsk-tx-helper-provider');

const BRIDGE_ADDRESS = "0x0000000000000000000000000000000001000006";

var assertKeyControl = (federates) => (begin, end, amountToTransferInWeis) => {
    var rskClients = federates
      .slice(begin, end)
      .map(federate => rsk.getClient(federate.host));
    var rskClient = rskClients[0];

    var federateAddresses = federates
      .slice(begin, end)
      .map((federate) => rskClient.rsk.utils.publicKeyToAddress(
          bitcoin.keys.publicKeyToUncompressed(federate.publicKeys.rsk)
      ));

    var utils = rskUtilsLegacy.with(null, rskClient, null);

    // Do we need to send some money to the federates first?
    var transfer = Promise.resolve();
    if (amountToTransferInWeis != null && amountToTransferInWeis > 0) {
      federateAddresses.forEach(federateAddress => {
        transfer = transfer
          .then(() => rskClient.eth.getBalance(federateAddress))
          .then((balance) => {
            // Only transfer if no balance
            if (Number(balance) === 0) {
              return utils.sendFromCow(federateAddress, amountToTransferInWeis);
            }
          });
      })
    }

    return rskUtils.mineAndSync(getRskTransactionHelpers())
      .then(() => transfer)
      .then(() => rskUtilsLegacy.waitForSync(rskClients))
      .then(() => checkUpdateBridge(rskClients, federateAddresses));
};

var checkUpdateBridge = async (rskClients, federateAddresses, fedIndex) => {
    if (fedIndex == null) {
        return checkUpdateBridge(rskClients, federateAddresses, 0);
    }

    if (fedIndex === rskClients.length) {
        return Promise.resolve();
    }

    var initialBlockNumber;

    var client = rskClients[fedIndex];
    var address = federateAddresses[fedIndex].toLowerCase();
    const bridge = getBridge(client);

    var updateCollectionsData = bridge.methods.updateCollections().encodeABI();

    const rskTxHelpers = getRskTransactionHelpers();
    
    return Promise.resolve()
        .then(() => rskUtils.mineAndSync(rskTxHelpers))
        .then(() => client.eth.getBlockNumber())
        .then((bn) => {
            initialBlockNumber = Number(bn);
        })
        .then(() => client.fed.updateBridge())
        .then(() => wait(500))
        .then(() => rskUtils.mineAndSync(rskTxHelpers))
        .then(() => client.eth.getBlockNumber())
        .then((bn) => {
            expect(Number(bn)).to.equal(initialBlockNumber+1);
        })
        .then(() => client.eth.getBlockTransactionCount(initialBlockNumber+1))
        .then((txCount) => {
            var blockNumber = initialBlockNumber+1;
            var txsPromise = [];

            for (var i = 0; i < txCount; i++) {
                txsPromise.push(client.eth.getTransactionFromBlock(blockNumber, i));
            }

            return Promise.all(txsPromise).then((txs) => txs.reduce((found, tx) => {
                return found || (
                        tx.to === BRIDGE_ADDRESS &&
                        tx.from.toLowerCase() === address &&
                        tx.input === updateCollectionsData
                    );
            }, false));
        }).then((found) => {
            expect(found, `Federate node at index ${fedIndex} not able to update the bridge`).to.be.true;
        }).then(() => checkUpdateBridge(rskClients, federateAddresses, fedIndex+1));
};

module.exports = {
    with: (federates) => ({
        assertKeyControl: assertKeyControl(federates),
    })
};
