const expect = require('chai').expect;
const { getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getBtcClient } = require('../btc-client-provider');
const { getBridge, getLatestActiveForkName } = require('../precompiled-abi-forks-util');
const { activateFork, sendTxWithCheck, getLatestForkName, waitAndUpdateBridge } = require('../rsk-utils');
const { ensure0x } = require('../utils');

let rskTxHelper;
let btcTxHelper;
let bridge;

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

            bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
        });
    
        it('should return 0 and increment BTC blockchain size when calling receiveHeader method', async () => {
            const cowAddress = await rskTxHelper.newAccountWithSeed('cow');

            await waitAndUpdateBridge(rskTxHelper);

            const blockHashes = await btcTxHelper.mine();
            const blockHeader = await btcTxHelper.getBlockHeader(blockHashes[0], false);
            const blockchainInitialHeigth = await bridge.methods.getBtcBlockchainBestChainHeight().call();

            await sendTxWithCheck(
                rskTxHelper,
                bridge.methods.receiveHeader(ensure0x(blockHeader)),
                cowAddress,
                (result) => { expect(Number(result)).to.be.equal(0) }
            );
            const blockchainFinalHeight = await bridge.methods.getBtcBlockchainBestChainHeight().call();
            expect(Number(blockchainFinalHeight)).to.be.equal(Number(blockchainInitialHeigth) + 1);
        });

        it('should return -1 when calling receiveHeader method consecutively', async () => {
            const blockHashes = await btcTxHelper.mine();
            const blockHeader = await btcTxHelper.getBlockHeader(blockHashes[0], false);
            const result = await bridge.methods.receiveHeader(ensure0x(blockHeader)).call();
            expect(result).to.be.equal('-1');
            }
        );
    });
};

module.exports = {
    execute,
};


