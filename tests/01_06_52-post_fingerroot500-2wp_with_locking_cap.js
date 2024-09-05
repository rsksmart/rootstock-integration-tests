const expect = require('chai').expect
const { sequentialPromise, wait } = require('../lib/utils');
const CustomError = require('../lib/CustomError');
const peglib = require('peglib');

const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const pegAssertions = require('../lib/assertions/2wp');
const whiteListAssertionsLegacy = require('../lib/assertions/whitelisting-legacy');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

let federationAddress;
let btcClient;
let rskClient;
let rskClients;
let pegClient;
let test;
let expectedLockingCap;
let whitelistTestLegacy;
let rskTxHelpers;
let utils;

const NETWORK = bitcoin.networks.testnet;
const BTC_TX_FEE = bitcoin.btcToSatoshis(0.001);

// Skipped due to 'running with all forks active' changes.

  describe.skip('Lock funds with locking cap', function() {
  
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
        whitelistTestLegacy = whiteListAssertionsLegacy.with(btcClient, rskClient, pegClient);
        utils = rskUtilsLegacy.with(btcClient, rskClient, pegClient);
        rskTxHelpers = getRskTransactionHelpers();
  
        //Grab the federation address
        federationAddress = await rskClient.rsk.bridge.methods.getFederationAddress().call();
        await btcClient.importAddress(federationAddress, 'federations');

        const initialFedBalance = Number((await btcClient.getAddressBalance(federationAddress))[federationAddress]) || 0;
        let currentLockingCap = Number(await rskClient.rsk.bridge.methods.getLockingCap().call());
        // leave a 50% margin for these tests
        expectedLockingCap = initialFedBalance * 1.5;
        const authAddress = await rskClient.eth.personal.importRawKey("da6a5451bfd74829307ec6d4a8c55174d4859169f162a8ed8fcba8f7636e77cc", '');
        await utils.sendFromCow(authAddress, rskClient.utils.toWei('100'));
        while (expectedLockingCap > currentLockingCap) {
          // I have to increment the locking cap up to 200% each time
          let nextIncrement = Number(currentLockingCap) * 2;
          if (nextIncrement > expectedLockingCap) {
            nextIncrement = expectedLockingCap;
          }
          const callResult = rskClient.rsk.bridge.methods.increaseLockingCap(nextIncrement).send({ from: authAddress });
          await rskUtils.mineAndSync(rskTxHelpers);
          await callResult;

          const newValue = Number(await rskClient.rsk.bridge.methods.getLockingCap().call());
          expect(newValue).to.be.at.least(currentLockingCap);
          currentLockingCap = newValue;
        }
        expectedLockingCap = currentLockingCap;

        // Mine a few rsk blocks to prevent being at the beginning of the chain,
        // which could trigger border cases we're not interested in
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

    it('should return BTC using same UTXOs', async () => {
      try {
        const initialFedBalance = (await btcClient.getAddressBalance(federationAddress))[federationAddress] || 0;
        expect(initialFedBalance).to.be.lessThan(expectedLockingCap);
        
        const INITIAL_BTC_BALANCE = expectedLockingCap + bitcoin.btcToSatoshis(2);

        const addresses = await pegClient.generateNewAddress('test');
        expect(addresses.inRSK).to.be.true;
  
        await whitelistTestLegacy.assertAddLimitedLockWhitelistAddress(addresses.btc, INITIAL_BTC_BALANCE)();
        await btcClient.sendToAddress(addresses.btc, INITIAL_BTC_BALANCE);
        await btcClient.generate(1);
        await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE, "Wrong initial BTC balance");
        await wait(1000);
        
        const AMOUNT_TO_TRY_TO_LOCK = expectedLockingCap;
        //TODO: This should be 0.001 when this test runs before feePerKb change
        const MAX_EXPECTED_FEE = bitcoin.btcToSatoshis(0.001);
        
        const lockOutputs = {};
        lockOutputs[federationAddress] = AMOUNT_TO_TRY_TO_LOCK;

        const lockBtcTxId = await btcClient.sendFromTo(addresses.btc, lockOutputs, BTC_TX_FEE, 1);
        const lockBtcTx = await btcClient.getTransaction(lockBtcTxId);
        
        await btcClient.generate(3);

        await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE - AMOUNT_TO_TRY_TO_LOCK - BTC_TX_FEE, 'Lock BTC debit');
        await test.assertBitcoinBalance(federationAddress, initialFedBalance + AMOUNT_TO_TRY_TO_LOCK, `Lock BTC federation ${federationAddress} credit`);
        
        await wait(500);

        await rskClient.fed.updateBridge();
        await rskUtils.mineAndSync(rskTxHelpers);
        
        const currentRskBalance = await rskClient.eth.getBalance(addresses.rsk);
        
        expect(Number(currentRskBalance), 'Wrong RSK balance').to.equal(0);
        
        await rskUtilsLegacy.triggerRelease(rskClients, btcClient);

        const btcBalance = (await btcClient.getAddressBalance(addresses.btc))[addresses.btc] || 0;
        const difference = INITIAL_BTC_BALANCE - btcBalance;

        // Consider the lock and paying the return fee as well, hence times 2
        expect(difference).to.be.at.most(MAX_EXPECTED_FEE * 2);
        await test.assertBitcoinBalance(federationAddress, initialFedBalance);
        
        const nonLockUtxos = (await btcClient.getUnspentForAddress(addresses.btc))
            .filter(utxo => utxo.txid !== lockBtcTxId);
        expect(nonLockUtxos.length).to.equal(1);

        const returnUtxo = nonLockUtxos[0];
        expect(AMOUNT_TO_TRY_TO_LOCK - returnUtxo.amount).to.be.at.most(MAX_EXPECTED_FEE);
        const returnTx = await btcClient.getTransaction(returnUtxo.txid);
        expect(returnTx.vin.length).to.equal(lockBtcTx.vout.length - 1); // Don't consider the change output
        returnTx.vin.forEach((txInput) => {
            expect(txInput.txid).to.equal(lockBtcTxId);
        });
      } 
      catch (err) {
          throw new CustomError('2wp locking cap failure', err);
      }
    });
});
