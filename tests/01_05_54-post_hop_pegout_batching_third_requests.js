const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const { bitcoin, rsk, pegUtils } = require('peglib');
const NETWORK = bitcoin.networks.testnet;
const CustomError = require('../lib/CustomError');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const _2wpUtilsLegacy = require('../lib/2wp-utils-legacy');
const { sequentialPromise, wait } = require('../lib/utils');
const pegAssertions = require('../lib/assertions/2wp');
const { NUMBER_OF_BLOCKS_BTW_PEGOUTS } = require('../lib/constants');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

let currentBlockNumber;
let test;
let federationAddress;
let assertCallToBridgeMethodsRunner;
let pegoutCount = 0;
let rskClients;
let rskClient;
let btcClient;
let pegClient;
let rskTxHelpers;

describe('Pegout Batching - Execute Pegout Transaction And Call New Bridge Methods', function () {

    before(async () => {
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
        test = pegAssertions.with(btcClient, rskClient, pegClient, rskClients);
        rskTxHelpers = getRskTransactionHelpers();

        // Grab the federation address
        federationAddress = await rskClient.rsk.bridge.methods.getFederationAddress().call();
        await btcClient.importAddress(federationAddress, 'federations');

        // Mine a few rsk blocks to prevent being at the beginning of the chain,
        // which could trigger border cases we're not interested in
        await sequentialPromise(10, () => rskUtils.mineAndSync(rskTxHelpers));

        // Update the bridge to sync btc blockchains
        await rskClient.fed.updateBridge();
        await rskUtils.mineAndSync(rskTxHelpers);

        return federationAddress;
    });

    describe('Corner cases', function () {
        // TODO: Skipping this test for the moment since it seems to increase the erratical failures
        it.skip('Pegout Tx Above BtcTx Max Size(100,000b) Should Split', async () => {
            try {
                const BTC_BALANCE = bitcoin.btcToSatoshis(1000);
                const PEGIN_VALUE_PER_OUTPUT = bitcoin.btcToSatoshis(0.5);

                const addresses = await pegClient.generateNewAddress('test');
                expect(addresses.inRSK).to.be.true;

                await btcClient.sendToAddress(addresses.btc, BTC_BALANCE);
                await btcClient.generate(1);
                await test.assertBitcoinBalance(addresses.btc, BTC_BALANCE, "Wrong initial BTC balance");
                await wait(1000);

                // Create Pegin with 1000 outputs to the federation address
                const outputs = [];
                for (let i = 0; i < 1000; i++) {
                    outputs.push({address: federationAddress, amount: PEGIN_VALUE_PER_OUTPUT});
                }
                await test.assertLock(addresses, outputs);

                await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 1);
                pegoutCount++;

                await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, 1, 2);
                pegoutCount += 2;
                
                const nextPegoutCreationBlockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();

                await rskUtilsLegacy.triggerPegoutEvent(rskClients, async () => {
                    const expectedNextPegoutCreationBlockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();
                    expect(expectedNextPegoutCreationBlockNumber).to.equal(nextPegoutCreationBlockNumber);
                    // Verify Pegout Split Correctly
                    let count = await rskClient.rsk.bridge.methods.getQueuedPegoutsCount().call();
                    const afterSplitPegoutCount = Math.ceil(pegoutCount / 2);
                    expect(Number(count)).to.equal(afterSplitPegoutCount);
                }, async () => currentBlockNumber = await rskClient.eth.getBlockNumber());

                await assertCallToBridgeMethodsRunner(0, currentBlockNumber + NUMBER_OF_BLOCKS_BTW_PEGOUTS);
            } catch (error) {
                throw new CustomError('pegout request creation failure', error);
            }
        })

        it('Not Enough Funds To Process Pegouts', async () => {
            try {
                pegoutCount = 0;
                const bridgeState = await getBridgeState(rskClient);
                const utxosListSum = bridgeState.activeFederationUtxos.reduce((previousValue, currentValue) => previousValue + currentValue.valueInSatoshis, 0);

                await _2wpUtilsLegacy.createPegoutRequest(rskClient, pegClient, bitcoin.satoshisToBtc(utxosListSum) + 1);
                pegoutCount++;

                await rskUtilsLegacy.increaseBlockToNextPegoutHeight(rskClient);

                await rskClient.fed.updateBridge();
                await rskUtils.mineAndSync(rskTxHelpers);

                // Verify Pegout Request Is Still On The Queue
                let count = await rskClient.rsk.bridge.methods.getQueuedPegoutsCount().call();
                expect(Number(count)).to.equal(pegoutCount);

                // Verify Next Pegout Height Is Not Updated
                currentBlockNumber = await rskClient.eth.getBlockNumber();
                let nextPegoutCreationBlockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();
                expect(currentBlockNumber).to.be.greaterThan(Number(nextPegoutCreationBlockNumber));

                // Pegin To Process Pegout
                const BTC_BALANCE = utxosListSum * 2;
                const PEGIN_OUTPUT_VALUE = utxosListSum;

                const addresses = await pegClient.generateNewAddress('test');
                expect(addresses.inRSK).to.be.true;

                await btcClient.sendToAddress(addresses.btc, BTC_BALANCE);
                await btcClient.generate(1);
                await test.assertBitcoinBalance(addresses.btc, BTC_BALANCE, "Wrong initial BTC balance");
                await wait(1000);
                await test.assertLock(addresses, [{address: federationAddress, amount: PEGIN_OUTPUT_VALUE}]);

                // Try Pegout Again
                await rskUtilsLegacy.triggerPegoutEvent(rskClients, async () => currentBlockNumber = await rskClient.eth.getBlockNumber());

                // Verify There Are No Pegout Requests
                count = await rskClient.rsk.bridge.methods.getQueuedPegoutsCount().call();
                expect(Number(count)).to.equal(0);

                nextPegoutCreationBlockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();
                expect(Number(nextPegoutCreationBlockNumber)).to.be.greaterThan(currentBlockNumber);
            } catch (error) {
                throw new CustomError('pegout request creation failure', error);
            }
        })
    });
});
