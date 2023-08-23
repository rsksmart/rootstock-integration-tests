const expect = require('chai').expect
const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const CustomError = require('../lib/CustomError');

const NETWORK = bitcoin.networks.testnet;

describe('Calling registerFastBridgeBtcTransaction before iris', function() {

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

    it('should fail when calling registerFastBridgeBtcTransaction method', async () => {
      try {
          let randomHex = rskClient.utils.randomHex;
          let stringHex = randomHex(32);
          let randomAddress = randomHex(20);
          await expect(
            rskClient.rsk.bridge.methods.registerFastBridgeBtcTransaction("0x", 1, stringHex, stringHex, stringHex, randomAddress, stringHex, false).call()
          ).to.be.rejected;
      }
      catch (err) {
        throw new CustomError('registerFastBridgeBtcTransaction call failure', err);
      }
    })
});
