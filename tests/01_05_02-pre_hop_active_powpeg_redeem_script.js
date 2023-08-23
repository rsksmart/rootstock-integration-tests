const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const rsk = require('peglib').rsk;
const CustomError = require('../lib/CustomError');

let rskClient;

describe('Calling getActivePowpegRedeemScript method before hop', function() {

    before(() => {
      rskClient = rsk.getClient(Runners.hosts.federate.host);
    });
  
    it('should be rejected when calling getActivePowpegRedeemScript method', async () => {
      try{
        await expect(rskClient.rsk.bridge.methods.getActivePowpegRedeemScript().call()).to.be.rejected;
      }
      catch (err) {
        throw new CustomError('getActivePowpegRedeemScript call failure', err);
      }
    })
});
