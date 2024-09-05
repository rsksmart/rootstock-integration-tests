const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const web3 = require('web3');
const CustomError = require('../lib/CustomError');

const NETWORK = bitcoin.networks.testnet;

// Should the name of this test class simply be: 01_03_03-coinbase_information?

describe('Calling coinbase information methods before papyrus', function() {
  
    before(() => {
      rskClient = rsk.getClient(Runners.hosts.federate.host);
      btcClient = bitcoin.getClient(
        Runners.hosts.bitcoin.rpcHost,
        Runners.hosts.bitcoin.rpcUser,
        Runners.hosts.bitcoin.rpcPassword,
        NETWORK
      );
      pegClient = pegUtils.using(btcClient, rskClient);
      utils = rskUtilsLegacy.with(btcClient, rskClient, pegClient);
    });
  
    it('should return empty object when calling registerBtcCoinbaseTransaction method', async () => {
      try{
          let randomHex = web3.utils.randomHex;
          let stringHex = randomHex(32);
          let callResult = await rskClient.rsk.bridge.methods.registerBtcCoinbaseTransaction("0x", stringHex, stringHex, stringHex, stringHex).call();
          expect(callResult).to.be.empty;
      }
      catch (err) {
        throw new CustomError('registerBtcCoinbaseTransaction call failure', err);
      }
    })

    // Should assert for true instead?
    it.skip('should return false when calling hasBtcBlockCoinbaseTransactionInformation method', async () => {
        try{
            let randomHex = web3.utils.randomHex;
            let stringHex = randomHex(32);
            await expect(rskClient.rsk.bridge.methods.hasBtcBlockCoinbaseTransactionInformation(stringHex).call()).to.be.rejected;
        }
        catch (err) {
          throw new CustomError('hasBtcBlockCoinbaseTransactionInformation call failure', err);
        }
      })
});