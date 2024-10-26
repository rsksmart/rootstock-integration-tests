const expect = require('chai').expect
const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const CustomError = require('../lib/CustomError');
const { FEE_PER_KB_CHANGER_PRIVATE_KEY } = require('../lib/constants');

const NETWORK = bitcoin.networks.testnet;

const FEE_PER_KB_CHANGER_ADDRESS = '53f8f6dabd612b6137215ddd7758bb5cdd638922';
const MAX_FEE_PER_KB = 5000000;

const RANDOM_PK = 'a4896a3f93bf4bf58378e579f3cf193bb4af1022af7d2089f37d8bae7157b85f';
const RANDOM_ADDR = '42a3d6e125aad539ac15ed04e1478eb0a4dc1489';

describe('Fee per kb change voting', function() {
  const startingFeePerKb = bitcoin.btcToSatoshis(0.001);

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

  it('should have a default fee per kb of millicoin', async () => {
    try{
      var feePerKb = await rskClient.rsk.bridge.methods.getFeePerKb().call();
      expect(Number(feePerKb)).to.equal(startingFeePerKb);
    }
    catch (err) {
      throw new CustomError('Having a default fee per kb millicoin failure', err);
    }
  });

  it('should reject unauthorized votes', async () => {
    try{
      const newFeePerKb = bitcoin.btcToSatoshis(0.005);
      var addr = await rskClient.eth.personal.importRawKey(RANDOM_PK, '');
      expect(addr.slice(2)).to.equal(RANDOM_ADDR);
      
      await rskClient.eth.personal.unlockAccount(addr, '');

      var result = await rskClient.rsk.bridge.methods.voteFeePerKbChange(newFeePerKb).call({ from: RANDOM_ADDR });
      expect(Number(result)).to.equal(-10); // unsuccessful vote

      var feePerKb = await rskClient.rsk.bridge.methods.getFeePerKb().call();
      expect(Number(feePerKb)).to.equal(startingFeePerKb);
    }
    catch (err) {
      throw new CustomError('Reject unauthorized votes failure', err);
    }
  });

  it('should reject votes above the max fee per kb value', async () => {
    try{
      const newFeePerKb = MAX_FEE_PER_KB + 1;
      var addr = await rskClient.eth.personal.importRawKey(FEE_PER_KB_CHANGER_PRIVATE_KEY, '');
      expect(addr.slice(2)).to.equal(FEE_PER_KB_CHANGER_ADDRESS);

      await rskClient.eth.personal.unlockAccount(addr, '');

      await utils.sendTxWithCheck(
        rskClient.rsk.bridge.methods.voteFeePerKbChange(newFeePerKb),
        (result) => { expect(Number(result)).to.equal(-2); }, // excessive fee per kb
        FEE_PER_KB_CHANGER_ADDRESS
      )();

      var feePerKb = await rskClient.rsk.bridge.methods.getFeePerKb().call();
      expect(Number(feePerKb)).to.equal(startingFeePerKb);
    }
    catch (err) {
      throw new CustomError('Should reject votes above the max fee per kb value failure', err);
    }
  });

  it('should be able to vote and change the fee per kb', async () => {
    try{
      const newFeePerKb = bitcoin.btcToSatoshis(0.005);
      var addr = await rskClient.eth.personal.importRawKey(FEE_PER_KB_CHANGER_PRIVATE_KEY, '');
      expect(addr.slice(2)).to.equal(FEE_PER_KB_CHANGER_ADDRESS);

      await rskClient.eth.personal.unlockAccount(addr, '');

      await utils.sendTxWithCheck(
        rskClient.rsk.bridge.methods.voteFeePerKbChange(newFeePerKb),
        (result) => { expect(Number(result)).to.equal(1); }, // successful vote
        FEE_PER_KB_CHANGER_ADDRESS
      )();

      var feePerKb = await rskClient.rsk.bridge.methods.getFeePerKb().call();
      expect(Number(feePerKb)).to.equal(newFeePerKb);
    }
    catch (err) {
      throw new CustomError('Should be able to vote ands change the fee per kb failure', err);
    }
  });
});
