const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const CustomError = require('../lib/CustomError');

const NETWORK = bitcoin.networks.testnet;

// Skipped due to 'running with all forks active' changes.

describe.skip('Calling locking cap methods before papyrus200', function() {
  
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
  
    it('should return 0 when calling getLockingCap method', async () => {
      try{
        await expect(rskClient.rsk.bridge.methods.getLockingCap().call()).to.be.rejected;
      }
      catch (err) {
        throw new CustomError('getLockingCap call failure', err);
      }
    })

    it('should return false when calling increaseLockingCap method', async () => {
        try{
          var increaseLockingCap = 1001;
          await expect(rskClient.rsk.bridge.methods.increaseLockingCap(increaseLockingCap).call()).to.be.rejected;
        }
        catch (err) {
          throw new CustomError('increaseLockingCap call failure', err);
        }
      })
});
