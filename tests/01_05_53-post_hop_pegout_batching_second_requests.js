const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const { bitcoin, rsk, pegUtils } = require('peglib');
const NETWORK = bitcoin.networks.testnet;
const CustomError = require('../lib/CustomError');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const _2wpUtilsLegacy = require('../lib/2wp-utils-legacy');
const pegAssertions = require('../lib/assertions/2wp');
const { NUMBER_OF_BLOCKS_BTW_PEGOUTS } = require('../lib/constants/pegout-constants');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

let pegoutCount = 0;
let currentBlockNumber;
let assertCallToBridgeMethodsRunner;
let rskTxHelpers;

describe('Pegout Batching - Execute Pegout Transaction And Call New Bridge Methods', function () {

    before(() => {
        rskClients = Runners.hosts.federates.map(federate => rsk.getClient(federate.host));
        rskClient = rsk.getClient(Runners.hosts.federate.host);
        btcClient = bitcoin.getClient(
            Runners.hosts.bitcoin.rpcHost,
            Runners.hosts.bitcoin.rpcUser,
            Runners.hosts.bitcoin.rpcPassword,
            NETWORK
        );
        assertCallToBridgeMethodsRunner = pegAssertions.assertCallToPegoutBatchingBridgeMethods(rskClient);
        pegClient = pegUtils.using(btcClient, rskClient);
        rskTxHelpers = getRskTransactionHelpers();
    });

    it('Execute Pegout Transaction and Call new bridge methods after successful pegout transaction', async () => {
        try {
            await rskUtilsLegacy.triggerPegoutEvent(rskClients, async () => currentBlockNumber = await rskClient.eth.getBlockNumber());

            await assertCallToBridgeMethodsRunner(0, currentBlockNumber + NUMBER_OF_BLOCKS_BTW_PEGOUTS);
        } catch (error) {
            throw new CustomError('new bridge methods call failure', error);
        }
    })

    it('should create pegout requests, execute pegout transaction when height is not reached and when height is reached', async () => {
        try {
            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.5);
            pegoutCount++;

            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.8);
            pegoutCount++;

            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.6, 2);
            pegoutCount += 2;

            // Execute pegout transaction when height is not reached
            await rskClient.fed.updateBridge();
            await rskUtils.mineAndSync(rskTxHelpers);

            // Call new bridge methods after failed pegout transaction because height is not reached
            const count = await rskClient.rsk.bridge.methods.getQueuedPegoutsCount().call();
            expect(Number(count)).to.equal(pegoutCount);

            currentBlockNumber = await rskClient.eth.getBlockNumber();
            const nextPegoutCreationBlockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(Number(nextPegoutCreationBlockNumber)).to.be.greaterThan(currentBlockNumber);

            await rskUtilsLegacy.triggerPegoutEvent(rskClients, async () => currentBlockNumber = await rskClient.eth.getBlockNumber());

            await assertCallToBridgeMethodsRunner(0, currentBlockNumber + NUMBER_OF_BLOCKS_BTW_PEGOUTS);
        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })
});
