const expect = require('chai').expect;
const { getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getBtcClient } = require('../btc-client-provider');
const { getBridge } = require('../bridge-provider');
const { sendTxWithCheck, waitAndUpdateBridge } = require('../rsk-utils');
const { ensure0x } = require('../utils');

let rskTxHelper;
let btcTxHelper;

const execute = (description, getRskHost) => {
  describe(description, function() {

      before(async () => {
        rskTxHelper = getRskTransactionHelper(getRskHost());
        btcTxHelper = getBtcClient();

      });
    
      it('Calling receiveHeaders method with regular user should not increment BTC blockchain size', async () => {
        const bridge = await getBridge(rskTxHelper.getClient());
        await waitAndUpdateBridge(rskTxHelper);

        const blockNumberInitial = await bridge.methods.getBtcBlockchainBestChainHeight().call();
        const cowAddress = await rskTxHelper.newAccountWithSeed('cow');
        const blockHashes = await btcTxHelper.mine();
        const blockHeader = await btcTxHelper.getBlockHeader(blockHashes[0], false);

        const receiveHeadersMethodCall = bridge.methods.receiveHeaders([ensure0x(blockHeader)]);
        const checkCallback = (result) => { expect(result).to.be.empty };
        await sendTxWithCheck(rskTxHelper, receiveHeadersMethodCall, cowAddress, checkCallback);

        const blockNumberFinal = await bridge.methods.getBtcBlockchainBestChainHeight().call();
        expect(blockNumberInitial).to.be.equal(blockNumberFinal);
      });
  });
};

module.exports = {
  execute,
};
