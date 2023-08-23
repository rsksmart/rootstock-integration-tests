const expect = require('chai').expect
var { sequentialPromise, wait } = require('../lib/utils');
const bitcoin = require('peglib').bitcoin;
const rsk = require('peglib').rsk;
const pegUtils = require('peglib').pegUtils;
const pegAssertions = require('../lib/assertions/2wp');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const CustomError = require('../lib/CustomError');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

var federationAddress;
var btcClient;
var rskClient, rskClients;
var pegClient;
var test;
let rskTxHelpers;

const NETWORK = bitcoin.networks.testnet;

describe('Lock using p2sh-p2wpkh address', () => {
    before(async () => {
        btcClient = bitcoin.getClient(
            Runners.hosts.bitcoin.rpcHost,
            Runners.hosts.bitcoin.rpcUser,
            Runners.hosts.bitcoin.rpcPassword,
            NETWORK
        );
        rskClient = rsk.getClient(Runners.hosts.federate.host);
        rskClients = Runners.hosts.federates.map(federate => rsk.getClient(federate.host));
        pegClient = pegUtils.using(btcClient, rskClient);
        test = pegAssertions.with(btcClient, rskClient, pegClient);
        utils = rskUtilsLegacy.with(btcClient, rskClient, pegClient);
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

    it('should work when using p2sh-p2wpkh address', async () => {
        try {
            const INITIAL_BTC_BALANCE = bitcoin.btcToSatoshis(40);
            const INITIAL_RSK_BALANCE = bitcoin.btcToSatoshis(10);
            const MAX_EXPECTED_FEE = bitcoin.btcToSatoshis(0.001);

            var addresses = await pegClient.generateNewAddress('test', 'p2sh-segwit');
            expect(addresses.inRSK).to.be.true;

            await btcClient.sendToAddress(addresses.btc, INITIAL_BTC_BALANCE);
            await btcClient.generate(1);
            await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE, "Wrong initial BTC balance");
            await wait(1000);

            var btcBalances = await btcClient.getAddressBalance(federationAddress);
            initialFederationBalance = btcBalances[federationAddress] || 0;

            await test.assertLock(addresses, [{ address: federationAddress, amount: INITIAL_RSK_BALANCE }]);
        } 
        catch (err) {
            throw new CustomError('Transfer BTC to RBTC failure', err);
        }
    });   
});
