const expect = require('chai').expect;
const { getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getBtcClient } = require('../btc-client-provider');
const { getBridge, getLatestActiveForkName } = require('../precompiled-abi-forks-util');
const { activateFork, sendTxWithCheck, getLatestForkName, waitAndUpdateBridge } = require('../rsk-utils');
const { ensure0x } = require('../utils');

let rskTxHelper;
let btcTxHelper;

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
  const forkName = process.env.FORK_NAME || getLatestForkName().name;
  await activateFork(Runners.common.forks[forkName]);
};

const execute = (description, getRskHost) => {
  describe(description, function() {

      before(async () => {
        rskTxHelper = getRskTransactionHelper(getRskHost());
        btcTxHelper = getBtcClient();

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
          await fulfillRequirementsToRunAsSingleTestFile();
        }
      });
    
      it('Calling receiveHeaders method with regular user should not increment BTC blockchain size', async () => {
        const bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
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
