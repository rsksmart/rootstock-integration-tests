const expect = require('chai').expect
var { sequentialPromise, wait } = require('../lib/utils');
const CustomError = require('../lib/CustomError');
const peglib = require('peglib');

const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
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
var utils;
let rskTxHelpers;

const NETWORK = bitcoin.networks.testnet;

const INITIAL_BTC_BALANCE = bitcoin.btcToSatoshis(10);

const WHITELIST_CHANGE_PK = '3890187a3071327cee08467ba1b44ed4c13adb2da0d5ffcc0563c371fa88259c';
const WHITELIST_CHANGE_ADDR = '87d2a0f33744929da08b65fd62b627ea52b25f8e';

describe('Disable whitelisting', function() {
  var addresses;

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
      
      addresses = await pegClient.generateNewAddress('test');
      expect(addresses.inRSK).to.be.true;
      
      await btcClient.sendToAddress(addresses.btc, INITIAL_BTC_BALANCE);
      await btcClient.generate(1);
      await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE, 'Initial BTC balance');
      
      var addr = await rskClient.eth.personal.importRawKey(WHITELIST_CHANGE_PK, '');
      expect(addr.slice(2)).to.equal(WHITELIST_CHANGE_ADDR);
      
      await rskClient.eth.personal.unlockAccount(addr, '');
      await sequentialPromise(10, () => rskUtils.mineAndSync(rskTxHelpers));
    }
    catch (err) {
      throw new CustomError('Lock whitelisting failure', err);
    }
  });

  it('should disable lock whitelist', async () => {
    const INITIAL_BTC_BALANCE = bitcoin.btcToSatoshis(40);
    const INITIAL_RSK_BALANCE = bitcoin.btcToSatoshis(10);

    const addresses = await pegClient.generateNewAddress('test');
    expect(addresses.inRSK).to.be.true;

    await btcClient.sendToAddress(addresses.btc, INITIAL_BTC_BALANCE);
    await btcClient.generate(1);
    await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE, "Wrong initial BTC balance");
    await wait(1000);

    // address is not whitelisted
    await test.assertLock(addresses, [{ address: federationAddress, amount: INITIAL_RSK_BALANCE }], { fails: true });
    // wait for the btc to come back so we can use the assertLock method again
    await utils.waitForBtcToReturn(addresses.btc);

    const addr = await rskClient.eth.personal.importRawKey(WHITELIST_CHANGE_PK, '');
    expect(addr.slice(2)).to.equal(WHITELIST_CHANGE_ADDR);
    await rskClient.eth.personal.unlockAccount(addr, '');
    // can disable the whitelist
    await utils.sendTxWithCheck(
      rskClient.rsk.bridge.methods.setLockWhitelistDisableBlockDelay(200),
      (disableResult) => expect(Number(disableResult)).to.equal(1),
      WHITELIST_CHANGE_ADDR)();

    // disable whitelist doesn't work the second time
    await utils.sendTxWithCheck(
      rskClient.rsk.bridge.methods.setLockWhitelistDisableBlockDelay(10),
      (disableResult) => expect(Number(disableResult)).to.equal(-1),
      WHITELIST_CHANGE_ADDR)();

    await btcClient.generate(100);
    await wait(500);
    await rskClient.fed.updateBridge();
    await rskUtils.mineAndSync(rskTxHelpers);
    await wait(500);

    // address is still not able to send btc to bridge after 100 blocks
    await test.assertLock(addresses, [{ address: federationAddress, amount: INITIAL_RSK_BALANCE }], { fails: true });
    await utils.waitForBtcToReturn(addresses.btc);

    await btcClient.generate(100);
    await wait(500);
    await rskClient.fed.updateBridge();
    await rskUtils.mineAndSync(rskTxHelpers);
    await wait(500);

    // after 200 blocks the whitelist period has ended and we can send money to the bridge
    await test.assertLock(addresses, [{ address: federationAddress, amount: INITIAL_RSK_BALANCE }]);
  });
});
