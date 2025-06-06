const { rsk } = require('peglib');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const CustomError = require('../lib/CustomError');
const pegAssertions = require('../lib/assertions/2wp');
const { NUMBER_OF_BLOCKS_BTW_PEGOUTS } = require('../lib/constants/pegout-constants');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

// TODO: Refactor these tests
// Some tests fail after running all tests with all forks active from scratch.
// More analysis need to be done. Also, these tests use legacy functions. We need to refactor them.
describe.skip('Pegout Batching - Advance the blockchain until the next pegout creation height (no pegout requests).', function () {

    let rskTxHelpers;
    let rskClient;
    let assertCallToBridgeMethodsRunner;

    before(() => {
        rskClient = rsk.getClient(Runners.hosts.federate.host);
        assertCallToBridgeMethodsRunner = pegAssertions.assertCallToPegoutBatchingBridgeMethods(rskClient);
        rskTxHelpers = getRskTransactionHelpers();
    });

    it('should ensure no pegout is created and call new Bridge methods. Next pegout creation height should update', async () => {
        try {
            await rskUtilsLegacy.increaseBlockToNextPegoutHeight(rskClient);

            let currentBlockNumber = await rskClient.eth.getBlockNumber();

            await assertCallToBridgeMethodsRunner(0, currentBlockNumber);

            await rskClient.fed.updateBridge();
            await rskUtils.mineAndSync(rskTxHelpers);

            currentBlockNumber = await rskClient.eth.getBlockNumber();

            await assertCallToBridgeMethodsRunner(0, currentBlockNumber + NUMBER_OF_BLOCKS_BTW_PEGOUTS);

        } catch (error) {
            throw new CustomError('Next pegout height update failure', error);
        }
    })
});
