const expect = require('chai').expect;

const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const libUtils = require('../lib/utils');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const CustomError = require('../lib/CustomError');

const NETWORK = bitcoin.networks.testnet;

describe('Calling receiveHeaders after iris300', function() {
  
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
  
    it('Calling receiveHeaders method with regular user should not increment BTC blockchain size', async () => {
      try {
          let blockNumberInitial = await rskClient.rsk.bridge.methods.getBtcBlockchainBestChainHeight().call();
          let cowAddress = await rskClient.eth.personal.newAccountWithSeed('cow');
          let blockHash = await btcClient.generate(1);
          let blockHeader = await btcClient.getBlockHeader(blockHash[0], false);
          
          await utils.sendTxWithCheck(
            rskClient.rsk.bridge.methods.receiveHeaders([libUtils.ensure0x(blockHeader)]),
            (result) => { expect(result).to.be.empty },
            cowAddress
          )();
          
          let blockNumberFinal = await rskClient.rsk.bridge.methods.getBtcBlockchainBestChainHeight().call();
          expect(blockNumberInitial).to.be.equal(blockNumberFinal);
        }
        catch (err) {
            throw new CustomError('receiverHeaders call failure', err);
        }
    });
});
