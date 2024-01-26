const CustomError = require('../lib/CustomError');
const _2wpUtils = require('../lib/2wp-utils');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');
const { activateFork } = require('../lib/rsk-utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
    await activateFork(Runners.common.forks.hop401);
};

describe('Pegout Batching - New Pegout Requests Then Call new bridge methods', function () {

    let rskTxHelper;
    let pegoutCount = 0;
    let bridge;

    before(async () => {

        rskTxHelper = getRskTransactionHelper(Runners.hosts.federate.host);

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile();
        }

        bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
        
    });

    it('should create single pegout and call new bridge methods', async () => {
        try {
            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.1);

            pegoutCount++;

            const pendingPegoutCount = await bridge.methods.getQueuedPegoutsCount().call();
            expect(Number(pendingPegoutCount)).to.equal(pegoutCount);

            const expectedEstimatedFee = _2wpUtils.getPegoutEstimatedFees(pegoutCount);
            const estimatedFees = await bridge.methods.getEstimatedFeesForNextPegOutEvent().call();
            expect(Number(estimatedFees)).to.equal(expectedEstimatedFee);
 
            const nextPegoutCreationBlockNumber = await bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(Number(nextPegoutCreationBlockNumber)).to.equal(0);

        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })

    it('should create 1 pegout in a block, 1 pegout in the following block and call bridge methods', async () => {
        try {

            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.5);
            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.4);

            pegoutCount += 2;

            const pendingPegoutCount = await bridge.methods.getQueuedPegoutsCount().call();
            expect(Number(pendingPegoutCount)).to.equal(pegoutCount);

            const expectedEstimatedFee = _2wpUtils.getPegoutEstimatedFees(pegoutCount);
            const estimatedFees = await bridge.methods.getEstimatedFeesForNextPegOutEvent().call();
            expect(Number(estimatedFees)).to.equal(expectedEstimatedFee);
 
            const nextPegoutCreationBlockNumber = await bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(Number(nextPegoutCreationBlockNumber)).to.equal(0);

        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })

    it('should create 1 pegout in a block, 1 pegout in the following block, 2 in the following block and call bridge methods', async () => {
        try {
            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.5);
            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.8);
            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.6, 2);

            pegoutCount += 4;

            const pendingPegoutCount = await bridge.methods.getQueuedPegoutsCount().call();
            expect(Number(pendingPegoutCount)).to.equal(pegoutCount);

            const expectedEstimatedFee = _2wpUtils.getPegoutEstimatedFees(pegoutCount);
            const estimatedFees = await bridge.methods.getEstimatedFeesForNextPegOutEvent().call();
            expect(Number(estimatedFees)).to.equal(expectedEstimatedFee);
 
            const nextPegoutCreationBlockNumber = await bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(Number(nextPegoutCreationBlockNumber)).to.equal(0);

        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })
});
