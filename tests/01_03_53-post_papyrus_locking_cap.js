const expect = require('chai').expect
const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const pegAssertions = require('../lib/assertions/2wp');
const CustomError = require('../lib/CustomError');
var { sequentialPromise, wait } = require('../lib/utils');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

const NETWORK = bitcoin.networks.testnet;

describe('Calling locking cap methods after papyrus200 fork', function() {

    var federationAddress;
    var btcClient;
    var rskClient;
    var pegClient;
    var test;
    var utils;
    let rskTxHelpers;
  
    before(async () => {
      btcClient = bitcoin.getClient(
        Runners.hosts.bitcoin.rpcHost,
        Runners.hosts.bitcoin.rpcUser,
        Runners.hosts.bitcoin.rpcPassword,
        NETWORK
      );
      rskClient = rsk.getClient(Runners.hosts.federate.host);
      pegClient = pegUtils.using(btcClient, rskClient);
      utils = rskUtilsLegacy.with(btcClient, rskClient, pegClient);
      test = pegAssertions.with(btcClient, rskClient, pegClient);
      federationAddress = await rskClient.rsk.bridge.methods.getFederationAddress().call();
      rskTxHelpers = getRskTransactionHelpers();
      
      // Mine a few rsk blocks to prevent being at the beginning of the chain,
      // which could trigger border cases we're not interested in
      await sequentialPromise(10, () => rskUtils.mineAndSync(rskTxHelpers));
      
      // // Update the bridge to sync btc blockchains
      await rskClient.fed.updateBridge();
      await rskUtils.mineAndSync(rskTxHelpers);
  
      return federationAddress;
    });
  
    it('should return 1000 when calling getLockingCap method', async () => {
      try{
        var callResult = await rskClient.rsk.bridge.methods.getLockingCap().call();
        expect(Number(callResult)).to.equal(bitcoin.btcToSatoshis(1000));
      }
      catch (err) {
        throw new CustomError('getLockingCap call failure', err);
      }
    })

    it('should return true when calling increaseLockingCap method', async () => {
        try{
          var authAddress = await rskClient.eth.personal.importRawKey("da6a5451bfd74829307ec6d4a8c55174d4859169f162a8ed8fcba8f7636e77cc", '');
          expect(authAddress.slice(2)).to.equal("6913bd4715eff3b25501f3212f15df38296d1f21");

          await utils.sendFromCow(authAddress, rskClient.utils.toWei('100'));

          var increaseLockingCap = bitcoin.btcToSatoshis(1500);
          var callResult = await rskClient.rsk.bridge.methods.increaseLockingCap(increaseLockingCap).call({ from: authAddress });
          expect(callResult).to.be.true;

          var sendTxPromise = rskClient.rsk.bridge.methods.increaseLockingCap(increaseLockingCap).send({ from: authAddress });
          await wait(1000);
          await rskUtils.mineAndSync(rskTxHelpers);
          var sendTxResult = await sendTxPromise;
          expect(sendTxResult).not.null;

          var callResult = await rskClient.rsk.bridge.methods.getLockingCap().call();
          expect(Number(callResult)).to.equal(increaseLockingCap);
        }
        catch (err) {
          throw new CustomError('increaseLockingCap call failure', err);
        }
      })
});
