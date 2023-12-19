const expect = require('chai').expect;
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { activateFork, sendTxWithCheck } = require('../lib/rsk-utils');
const { ensure0x } = require('../lib/utils');

const fulfillRequirementsToRunAsSingleTestFile = async () => {
  await activateFork(Runners.common.forks.arrowhead600);
};

describe('Calling receiveHeaders after arrowhead600', function() {
  
    before(async () => {
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      btcTxHelper = getBtcClient();

      if(process.env.RUNNING_SINGLE_TEST_FILE) {
        await fulfillRequirementsToRunAsSingleTestFile();
      }
    });
  
    it('Calling receiveHeaders method with regular user should not increment BTC blockchain size', async () => {
      const bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
      const blockNumberInitial = await bridge.methods.getBtcBlockchainBestChainHeight().call();
      const cowAddress = await rskTxHelper.newAccountWithSeed('cow');
      const blockHash = await btcTxHelper.mine();
      const blockHeader = await btcTxHelper.getBlockHeader(blockHash[0], false);

      await sendTxWithCheck(
        rskTxHelper,
        bridge.methods.receiveHeaders([ensure0x(blockHeader)]),
        cowAddress,
        (result) => { expect(result).to.be.empty }
      );

      const blockNumberFinal = await bridge.methods.getBtcBlockchainBestChainHeight().call();
      expect(blockNumberInitial).to.be.equal(blockNumberFinal);
    });
});