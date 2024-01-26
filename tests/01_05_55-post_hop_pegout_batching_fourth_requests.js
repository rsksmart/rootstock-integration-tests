const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const rskUtils = require('../lib/rsk-utils');
const CustomError = require('../lib/CustomError');
const { NUMBER_OF_BLOCKS_BTW_PEGOUTS } = require('../lib/constants');
const _2wpUtils = require('../lib/2wp-utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
    await activateFork(Runners.common.forks.hop401);
};

describe('Pegout Batching - New Pegout Requests Then Call new bridge methods', function () {

    let rskTxHelper;
    let rskTxHelpers;
    let bridge;
    let btcTxHelper;

    before(async () => {

        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient();

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile();
        }

        bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
        
    });

    it('should create multiple pegouts in different blocks, execute pegouts and call bridge methods', async () => {
        try {

            const pegoutCount = 5;

            await _2wpUtils.createPegoutRequest(rskTxHelper, 1);
            await _2wpUtils.createPegoutRequest(rskTxHelper, 2);
            await _2wpUtils.createPegoutRequest(rskTxHelper, 3, 2);

            const initialPegoutCount = await bridge.methods.getQueuedPegoutsCount().call();
            expect(Number(initialPegoutCount)).to.equal(pegoutCount);

            let blockNumberWhenPegoutsWhereReleased;

            const pegoutCreatedValidations = async (localRskTxHelper) => {
                blockNumberWhenPegoutsWhereReleased = await localRskTxHelper.getBlockNumber();
            };
    
            const callbacks = {
                pegoutCreatedCallback: pegoutCreatedValidations,
            };

            await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper, callbacks);

            const pendingPegoutCount = await bridge.methods.getQueuedPegoutsCount().call();
            expect(Number(pendingPegoutCount)).to.equal(0);

            const expectedEstimatedFee = _2wpUtils.getPegoutEstimatedFees(pegoutCount);
            const estimatedFees = await bridge.methods.getEstimatedFeesForNextPegOutEvent().call();
            expect(Number(estimatedFees)).to.equal(expectedEstimatedFee);
 
            const newExpectedNextPegoutsCreationBlockNumber = blockNumberWhenPegoutsWhereReleased + NUMBER_OF_BLOCKS_BTW_PEGOUTS;
            const nextPegoutCreationBlockNumber = await bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(Number(nextPegoutCreationBlockNumber)).to.equal(newExpectedNextPegoutsCreationBlockNumber);

        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })
});
