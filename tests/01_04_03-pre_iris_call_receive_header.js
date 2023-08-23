const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const libUtils = require('../lib/utils');
const CustomError = require('../lib/CustomError');

const NETWORK = bitcoin.networks.testnet;

describe('Calling method receiveHeader before iris300', function() {
  
    before(() => {
      rskClient = rsk.getClient(Runners.hosts.federate.host);
      btcClient = bitcoin.getClient(
        Runners.hosts.bitcoin.rpcHost,
        Runners.hosts.bitcoin.rpcUser,
        Runners.hosts.bitcoin.rpcPassword,
        NETWORK
      );
    });
  
    it('should reject calling receiveHeader method before iris', async () => {
      try {
        let blockHash = await btcClient.generate(1);
        let blockHeader = await btcClient.getBlockHeader(blockHash[0], false);
        await expect(rskClient.rsk.bridge.methods.receiveHeader(libUtils.ensure0x(blockHeader)).call()).to.be.rejected;
      }
      catch (err) {
        throw new CustomError('receiveHeader call failure', err);
      }
    })
});
