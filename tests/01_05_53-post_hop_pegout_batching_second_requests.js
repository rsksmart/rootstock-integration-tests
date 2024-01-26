const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const CustomError = require('../lib/CustomError');
const { NUMBER_OF_BLOCKS_BTW_PEGOUTS } = require('../lib/constants');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const _2wpUtils = require('../lib/2wp-utils');
const { activateFork, waitAndUpdateBridge } = require('../lib/rsk-utils');
const { getBtcClient } = require('../lib/btc-client-provider');

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
    await activateFork(Runners.common.forks.hop401);
};

let pegoutCount = 0;
let rskTxHelpers;
let rskTxHelper;
let bridge;
let btcTxHelper;

describe('Pegout Batching - Execute Pegout Transaction And Call New Bridge Methods', function () {

    before(async () => {

        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient();

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile();
        }

        bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
        
    });

    it('Execute Pegout Transaction and Call new bridge methods after successful pegout transaction', async () => {
        try {

            let blockNumberWhenPegoutsWhereReleased;

            const pegoutCreatedValidations = async (localRskTxHelper) => {
                blockNumberWhenPegoutsWhereReleased = await localRskTxHelper.getBlockNumber();
            };
    
            const callbacks = {
                pegoutCreatedCallback: pegoutCreatedValidations,
            };

            await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper, callbacks);

            const pendingPegoutCount = await bridge.methods.getQueuedPegoutsCount().call();
            expect(0).to.equal(pendingPegoutCount);

            const expectedEstimatedFee = _2wpUtils.getPegoutEstimatedFees(pegoutCount);
            const estimatedFees = await bridge.methods.getEstimatedFeesForNextPegOutEvent().call();
            expect(Number(estimatedFees)).to.equal(expectedEstimatedFee);

            const newExpectedNextPegoutsCreationBlockNumber = blockNumberWhenPegoutsWhereReleased + NUMBER_OF_BLOCKS_BTW_PEGOUTS;
            const nextPegoutCreationBlockNumber = await bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(Number(nextPegoutCreationBlockNumber)).to.equal(newExpectedNextPegoutsCreationBlockNumber);

        } catch (error) {
            throw new CustomError('new bridge methods call failure', error);
        }
    })

    it('should create pegout requests, execute pegout transaction when height is not reached and when height is reached', async () => {
        try {
            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.5);
            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.8);
            await _2wpUtils.createPegoutRequest(rskTxHelper, 0.6, 2);

            pegoutCount += 4;

            // Execute pegout transaction when height is not reached
            await waitAndUpdateBridge(rskTxHelpers, 500);

            const initialPegoutCount = await bridge.methods.getQueuedPegoutsCount().call();
            expect(Number(initialPegoutCount)).to.equal(pegoutCount);

            let blockNumberWhenPegoutsWhereReleased = await rskTxHelper.getBlockNumber();
            const nextPegoutCreationBlockNumber = await bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(Number(nextPegoutCreationBlockNumber)).to.be.greaterThan(blockNumberWhenPegoutsWhereReleased);

            const pegoutCreatedCallback = async (localRskTxHelper) => {
                blockNumberWhenPegoutsWhereReleased = await localRskTxHelper.getBlockNumber();
            };
    
            const callbacks = {
                pegoutCreatedCallback,
            };

            await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper, callbacks);
            
            const pendingPegoutCount = await bridge.methods.getQueuedPegoutsCount().call();
            expect(pendingPegoutCount).to.equal(0);

            const expectedEstimatedFee = _2wpUtils.getPegoutEstimatedFees(pegoutCount);
            const estimatedFees = await bridge.methods.getEstimatedFeesForNextPegOutEvent().call();
            expect(Number(estimatedFees)).to.equal(expectedEstimatedFee);
 
            const newExpectedNextPegoutsCreationBlockNumber = blockNumberWhenPegoutsWhereReleased + NUMBER_OF_BLOCKS_BTW_PEGOUTS;
            const finalNextPegoutCreationBlockNumber = await bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(Number(finalNextPegoutCreationBlockNumber)).to.equal(newExpectedNextPegoutsCreationBlockNumber);

        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })
});
