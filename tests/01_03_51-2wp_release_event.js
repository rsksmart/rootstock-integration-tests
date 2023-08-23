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
const { getBtcClient } = require('../lib/btc-client-provider');

var federationAddress;
var btcClient;
var rskClient;
var rskClients;
var pegClient;
var test;
let rskTxHelpers;
let btcTxHelper;

const NETWORK = bitcoin.networks.testnet;

const INITIAL_BTC_BALANCE = bitcoin.btcToSatoshis(10);
const BTC_TX_FEE = bitcoin.btcToSatoshis(0.001);

const WHITELIST_CHANGE_PK = '3890187a3071327cee08467ba1b44ed4c13adb2da0d5ffcc0563c371fa88259c';
const WHITELIST_CHANGE_ADDR = '87d2a0f33744929da08b65fd62b627ea52b25f8e';

describe('Release events (for whitelisting) after papyrus activation', function() {
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
      btcTxHelper = getBtcClient();

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

      await wait(500);

      await rskClient.eth.personal.unlockAccount(addr, '');
      await wait(500);
      await sequentialPromise(10, () => rskUtils.mineAndSync(rskTxHelpers));
    }
    catch (err) {
      throw new CustomError('Release events after papyrus activation failure', err);
    }
  });

  // TODO: This is not truly needed. Leaving it to avoid erratical issue, will be removed once we refactor the tests
  beforeEach(async() => {
    await btcClient.generate(1);
    await wait(100);
    await rskClient.fed.updateBridge();
    await rskUtils.mineAndSync(rskTxHelpers);
  });

  var nonWhitelistedCases = [
    { amounts: [bitcoin.btcToSatoshis(15)] },
    { amounts: [bitcoin.btcToSatoshis(5), bitcoin.btcToSatoshis(7)] },
    { amounts: [bitcoin.btcToSatoshis(1), bitcoin.btcToSatoshis(23), bitcoin.btcToSatoshis(4)] },
  ];

  nonWhitelistedCases.forEach((testCase) => {
    it(`should return BTC from non-whitelisted addresses using same UTXOs as for lock attempt (${testCase.amounts.length} UTXOs)`, async () => {
      const AMOUNT_TO_TRY_TO_LOCK = testCase.amounts.reduce((a, v) => a+v);
      const MAX_EXPECTED_FEE = bitcoin.btcToSatoshis(0.001);
      // The extra 0.5 is to get some change back on the lock tx. This shouldn't really
      // change anything, but it will end up considering the most common case.
      const INITIAL_BTC_BALANCE = AMOUNT_TO_TRY_TO_LOCK + MAX_EXPECTED_FEE + bitcoin.btcToSatoshis(0.5);

      var lockOutputs = testCase.amounts.map(amount => ({
        address: federationAddress,
        amount: amount,
      }));

      var rskClient = rskClients[0];
      var addresses;
      var initialFederationBalance, initialBlockNumber;
      var lockBtcTxId, lockBtcTx;

      var newAddresses = await pegClient.generateNewAddress('test');
      addresses = newAddresses;
      expect(addresses.inRSK).to.be.true

      await btcClient.sendToAddress(addresses.btc, INITIAL_BTC_BALANCE);
      await btcClient.generate(1);
      await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE, "Wrong initial BTC balance");

      await wait(1000);

      var btcBalances = await btcClient.getAddressBalance(federationAddress);
      initialFederationBalance = btcBalances[federationAddress] || 0;

      lockBtcTxId = await btcClient.sendFromTo(addresses.btc, lockOutputs, BTC_TX_FEE, 1);
      lockBtcTx = await btcClient.getTransaction(lockBtcTxId);

      await btcClient.generate(3);

      await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE - AMOUNT_TO_TRY_TO_LOCK - BTC_TX_FEE, 'Lock BTC debit');
      await test.assertBitcoinBalance(federationAddress, initialFederationBalance + AMOUNT_TO_TRY_TO_LOCK, `Lock BTC federation ${federationAddress} credit`);

      await wait(500);

      await rskClient.fed.updateBridge();
      await rskUtils.mineAndSync(rskTxHelpers);
      initialBlockNumber = await rskClient.eth.getBlockNumber();
      var txHash = await rskUtilsLegacy.getTransactionHashFromTxToBridge('registerBtcTransaction', rsk, rskClient);
      var minExpectedValue = AMOUNT_TO_TRY_TO_LOCK - BTC_TX_FEE;
      await rskUtilsLegacy.getBridgeEventAndRunAssertions('release_requested', releaseCallback(txHash, minExpectedValue), rsk)(rskClient);

      await rskUtils.mineAndSync(rskTxHelpers);

      var currentBlockNumber = await rskClient.eth.getBlockNumber();
      expect(currentBlockNumber).to.equal(initialBlockNumber+1);

      var currentRskBalance = await rskClient.eth.getBalance(addresses.rsk);
      expect(Number(currentRskBalance), 'Wrong RSK balance').to.equal(0);

      await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

      await wait(500);

      var btcBalances = await btcClient.getAddressBalance([addresses.btc, federationAddress]);
      btcBalance = btcBalances[addresses.btc];
      var finalFederationBalance = btcBalances[federationAddress] || 0;
      var difference = INITIAL_BTC_BALANCE - btcBalance;
      // Consider the lock and paying the return fee as well, hence times 2
      expect(difference).to.be.at.most(MAX_EXPECTED_FEE * 2);
      expect(finalFederationBalance).to.equal(initialFederationBalance);

      var nonLockUtxos = (await btcClient.getUnspentForAddress(addresses.btc))
        .filter(utxo => utxo.txid !== lockBtcTxId);
      expect(nonLockUtxos.length).to.equal(1);

      var returnUtxo = nonLockUtxos[0];
      expect(AMOUNT_TO_TRY_TO_LOCK - returnUtxo.amount).to.be.at.most(MAX_EXPECTED_FEE);
      var returnTx = await btcClient.getTransaction(returnUtxo.txid);
      expect(returnTx.vin.length).to.equal(lockBtcTx.vout.length - 1); // Don't consider the change output
      expect(returnTx.vin.length).to.equal(testCase.amounts.length); // Don't consider the change output
      var nonMatchedAmounts = testCase.amounts.slice(0);
      returnTx.vin.forEach((txInput) => {
        expect(txInput.txid).to.equal(lockBtcTxId);
        var spentUtxo = lockBtcTx.vout[txInput.vout];
        var amountInSatoshis = bitcoin.btcToSatoshis(spentUtxo.value);
        nonMatchedAmounts = nonMatchedAmounts.filter(a => a !== amountInSatoshis);
      });
      expect(nonMatchedAmounts.length).to.equal(0);
    });
  });
});

var releaseCallback = (rskTxHash, minExpectedValue) => (decodedLog) => {
  expect(decodedLog[0]).to.be.equals(rskTxHash);
  expect(decodedLog.rskTxHash).to.be.equals(rskTxHash);
  expect(decodedLog[1]).to.not.be.undefined;
  expect(decodedLog.btcTxHash).to.not.be.undefined;
  expect(Number(decodedLog[2])).to.be.at.least(Number(minExpectedValue));
  expect(Number(decodedLog.amount)).to.be.at.least(Number(minExpectedValue));
}
