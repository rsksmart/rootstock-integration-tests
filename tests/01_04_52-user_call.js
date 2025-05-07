const expect = require('chai').expect
const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const libUtils = require('../lib/utils');
const CustomError = require('../lib/CustomError');

const NETWORK = bitcoin.networks.testnet;

describe('Calling registerFastBridgeBtcTransaction', function() {
  
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
  
    it('should return error when user calling registerFastBridgeBtcTransaction method', async () => {
      try {
          let errorUserCalls = -300;
          let randomHex = rskClient.utils.randomHex;
          let stringHex = randomHex(32);
          let randomAddress = randomHex(20);
          let addressBtc = (await pegClient.generateNewAddress('test')).btc;
          let addressBtcBytes = libUtils.ensure0x(bitcoin.addresses.decodeBase58Address(addressBtc));
          let callResult = await rskClient.rsk.bridge.methods.registerFastBridgeBtcTransaction("0x", 1, stringHex, stringHex, addressBtcBytes, randomAddress, addressBtcBytes, false).call();
          expect(Number(callResult)).to.equal(errorUserCalls);
      }
      catch (err) {
        throw new CustomError('registerFastBridgeBtcTransaction call failure', err);
      }
    })
});
