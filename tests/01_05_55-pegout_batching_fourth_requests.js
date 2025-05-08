const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const { bitcoin, rsk, pegUtils } = require('peglib');
const NETWORK = bitcoin.networks.testnet;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const CustomError = require('../lib/CustomError');
const _2wpUtilsLegacy = require('../lib/2wp-utils-legacy');
const pegAssertions = require('../lib/assertions/2wp');
const { NUMBER_OF_BLOCKS_BTW_PEGOUTS } = require('../lib/constants/pegout-constants');

// TODO: Refactor these tests
// Some tests fail after running all tests with all forks active from scratch.
// More analysis need to be done. Also, these tests use legacy functions. We need to refactor them.
describe.skip('Pegout Batching - New Pegout Requests Then Call new bridge methods', function () {

    let currentBlockNumber;
    let pegoutCount = 0;
    let rskClients;
    let rskClient;
    let btcClient;
    let pegClient;
    let assertCallToBridgeMethodsRunner;

    before(() => {
        rskClients = Runners.hosts.federates.map(federate => rsk.getClient(federate.host));
        rskClient = rsk.getClient(Runners.hosts.federate.host);
        btcClient = bitcoin.getClient(
            Runners.hosts.bitcoin.rpcHost,
            Runners.hosts.bitcoin.rpcUser,
            Runners.hosts.bitcoin.rpcPassword,
            NETWORK
        );
        pegClient = pegUtils.using(btcClient, rskClient);
        assertCallToBridgeMethodsRunner = pegAssertions.assertCallToPegoutBatchingBridgeMethods(rskClient);
    });

    it('should create multiple pegouts in different blocks, execute pegouts and call bridge methods', async () => {
        try {
            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 1);
            pegoutCount++;

            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 2);
            pegoutCount++;

            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 3, 2);
            pegoutCount += 2;

            const count = await rskClient.rsk.bridge.methods.getQueuedPegoutsCount().call();
            expect(Number(count)).to.equal(pegoutCount);

            await rskUtilsLegacy.triggerPegoutEvent(rskClients, async () => currentBlockNumber = await rskClient.eth.getBlockNumber());

            await assertCallToBridgeMethodsRunner(0, currentBlockNumber + NUMBER_OF_BLOCKS_BTW_PEGOUTS);
        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })
});
