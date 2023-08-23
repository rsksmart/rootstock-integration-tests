const { bitcoin, rsk, pegUtils } = require('peglib');
const NETWORK = bitcoin.networks.testnet;
const CustomError = require('../lib/CustomError');
const _2wpUtilsLegacy = require('../lib/2wp-utils-legacy');
const pegAssertions = require('../lib/assertions/2wp');

let pegoutCount = 0;

describe('Pegout Batching - New Pegout Requests Then Call new bridge methods', function () {

    before(() => {
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

    it('should create single pegout and call new bridge methods', async () => {
        try {
            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.1);
            pegoutCount++;

            assertCallToBridgeMethodsRunner(pegoutCount, 0);
        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })

    it('should create 1 pegout in a block, 1 pegout in the following block and call bridge methods', async () => {
        try {
            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.5);
            pegoutCount++;

            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.4);
            pegoutCount++;

            assertCallToBridgeMethodsRunner(pegoutCount, 0);
        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })

    it('should create 1 pegout in a block, 1 pegout in the following block, 2 in the following block and call bridge methods', async () => {
        try {
            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.5);
            pegoutCount++;

            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.8);
            pegoutCount++;

            await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 0.6, 2);
            pegoutCount += 2;

            assertCallToBridgeMethodsRunner(pegoutCount, 0);
        } catch (error) {
            throw new CustomError('pegout request creation failure', error);
        }
    })
});
