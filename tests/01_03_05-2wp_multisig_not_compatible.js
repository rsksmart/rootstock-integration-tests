const expect = require('chai').expect
var { sequentialPromise, wait } = require('../lib/utils');
const bitcoin = require('peglib').bitcoin;
const rsk = require('peglib').rsk;
const pegUtils = require('peglib').pegUtils;
const CustomError = require('../lib/CustomError');
const pegAssertions = require('../lib/assertions/2wp');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

var federationAddress;
var btcClient;
var rskClient;
var rskClients;
var pegClient;
var test;
let rskTxHelpers;

const NETWORK = bitcoin.networks.testnet;
const INITIAL_BTC_BALANCE = bitcoin.btcToSatoshis(10);

const WHITELIST_CHANGE_PK = '3890187a3071327cee08467ba1b44ed4c13adb2da0d5ffcc0563c371fa88259c';
const WHITELIST_CHANGE_ADDR = '87d2a0f33744929da08b65fd62b627ea52b25f8e';

describe('Lock multisig address', () => {
    before(async () => {
        try{
            btcClient = bitcoin.getClient(
              Runners.hosts.bitcoin.rpcHost,
              Runners.hosts.bitcoin.rpcUser,
              Runners.hosts.bitcoin.rpcPassword,
              NETWORK
            );
            rskClient = rsk.getClient(Runners.hosts.federate.host);
            rskClients = Runners.hosts.federates.map(federate => rsk.getClient(federate.host));
            pegClient = pegUtils.using(btcClient, rskClient);
            test = pegAssertions.with(btcClient, rskClient, pegClient, rskClients);
            utils = rskUtilsLegacy.with(btcClient, rskClient, pegClient);
            rskTxHelpers = getRskTransactionHelpers();
      
            // Grab the federation address
            federationAddress = await rskClient.rsk.bridge.methods.getFederationAddress().call();
            await btcClient.importAddress(federationAddress, 'federations');
            
            let addresses = await pegClient.generateNewAddress('test');
            expect(addresses.inRSK).to.be.true;
            
            await btcClient.sendToAddress(addresses.btc, INITIAL_BTC_BALANCE);
            await btcClient.generate(1);
            await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE, 'Initial BTC balance');
            
            let addr = await rskClient.eth.personal.importRawKey(WHITELIST_CHANGE_PK, '');
            expect(addr.slice(2)).to.equal(WHITELIST_CHANGE_ADDR);
            
            await rskClient.eth.personal.unlockAccount(addr, '');
            await sequentialPromise(10, () => rskUtils.mineAndSync(rskTxHelpers));
      
           // Update the bridge to sync btc blockchains
            await rskClient.fed.updateBridge();
            await rskUtils.mineAndSync(rskTxHelpers);
      
            return federationAddress;
        }
        catch (err) {
          throw new CustomError('Lock whitelisting failure', err);
        }
    });

    it('lock should fail when using multisig address', async () => {
        try {
            const INITIAL_BTC_BALANCE = bitcoin.btcToSatoshis(40);
            const INITIAL_RSK_BALANCE = bitcoin.btcToSatoshis(10);

            let multisigObj = await btcClient.generateMultisigAddress('test');

            await btcClient.sendToAddress(multisigObj.btc, INITIAL_BTC_BALANCE);
            await btcClient.generate(1);
            await test.assertBitcoinBalance(multisigObj.btc, INITIAL_BTC_BALANCE, "Wrong initial BTC balance");
            await wait(1000);

            let btcBalances = await btcClient.getAddressBalance(federationAddress);
            initialFederationBalance = btcBalances[federationAddress] || 0;

            await test.assertLock(multisigObj, [{ address: federationAddress, amount: INITIAL_RSK_BALANCE }], { fails: true });

            btcBalances = await btcClient.getAddressBalance([multisigObj.btc, federationAddress]);
            btcBalance = btcBalances[multisigObj.btc];
            let finalFederationBalance = btcBalances[federationAddress] || 0;

            expect(finalFederationBalance).to.be.greaterThan(initialFederationBalance);
            expect(INITIAL_BTC_BALANCE).to.be.greaterThan(btcBalance);
        } 
        catch (err) {
            throw new CustomError('Transfer BTC to RBTC failure', err);
        }
    });
})