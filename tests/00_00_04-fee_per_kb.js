const expect = require('chai').expect
const { btcToSatoshis } = require('@rsksmart/btc-eth-unit-converter');
const rskUtils = require('../lib/rsk-utils');
const { getBridge } = require('../lib/bridge-provider');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const CustomError = require('../lib/CustomError');
const { FEE_PER_KB_CHANGER_PRIVATE_KEY } = require('../lib/constants/fee-per-kb-constants');

const FEE_PER_KB_CHANGER_ADDRESS = '53f8f6dabd612b6137215ddd7758bb5cdd638922';
const MAX_FEE_PER_KB = 5000000;

const RANDOM_PK = 'a4896a3f93bf4bf58378e579f3cf193bb4af1022af7d2089f37d8bae7157b85f';
const RANDOM_ADDR = '42a3d6e125aad539ac15ed04e1478eb0a4dc1489';

describe('Fee per kb change voting', function() {

  const startingFeePerKb = Number(btcToSatoshis(0.001));
  let rskTxHelper;
  let bridge;

  before(async () => {
    const rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    bridge = await getBridge(rskTxHelper.getClient());
  });

  it('should have a default fee per kb of millicoin', async () => {
    try{
      const feePerKb = await bridge.methods.getFeePerKb().call();
      expect(Number(feePerKb)).to.equal(startingFeePerKb);
    }
    catch (err) {
      throw new CustomError('Having a default fee per kb millicoin failure', err);
    }
  });

  it('should reject unauthorized votes', async () => {
    try{
      const newFeePerKb = Number(btcToSatoshis(0.005));
      const addr = await rskTxHelper.importAccount(RANDOM_PK);
      expect(addr.slice(2)).to.equal(RANDOM_ADDR);
      
      await rskTxHelper.unlockAccount(addr);

      const result = await bridge.methods.voteFeePerKbChange(newFeePerKb).call({ from: RANDOM_ADDR });
      expect(Number(result)).to.equal(-10); // unsuccessful vote

      const feePerKb = await bridge.methods.getFeePerKb().call();
      expect(Number(feePerKb)).to.equal(startingFeePerKb);
    }
    catch (err) {
      throw new CustomError('Reject unauthorized votes failure', err);
    }
  });

  it('should reject votes above the max fee per kb value', async () => {
    try{
      const newFeePerKb = MAX_FEE_PER_KB + 1;
      const addr = await rskTxHelper.importAccount(FEE_PER_KB_CHANGER_PRIVATE_KEY);
      expect(addr.slice(2)).to.equal(FEE_PER_KB_CHANGER_ADDRESS);

      await rskTxHelper.unlockAccount(addr);

      await rskUtils.sendTxWithCheck(
        rskTxHelper,
        bridge.methods.voteFeePerKbChange(newFeePerKb),
        FEE_PER_KB_CHANGER_ADDRESS,
        (result) => { expect(Number(result)).to.equal(-2); } // excessive fee per kb
      );

      const feePerKb = await bridge.methods.getFeePerKb().call();
      expect(Number(feePerKb)).to.equal(startingFeePerKb);
    }
    catch (err) {
      throw new CustomError('Should reject votes above the max fee per kb value failure', err);
    }
  });

  it('should be able to vote and change the fee per kb', async () => {
    try{
      const newFeePerKb = Number(btcToSatoshis(0.005));
      const addr = await rskTxHelper.importAccount(FEE_PER_KB_CHANGER_PRIVATE_KEY);
      expect(addr.slice(2)).to.equal(FEE_PER_KB_CHANGER_ADDRESS);

      await rskTxHelper.unlockAccount(addr);

      await rskUtils.sendTxWithCheck(
        rskTxHelper,
        bridge.methods.voteFeePerKbChange(newFeePerKb),
        FEE_PER_KB_CHANGER_ADDRESS,
        (result) => { expect(Number(result)).to.equal(1); } // successful vote
      );

      const feePerKb = await bridge.methods.getFeePerKb().call();
      expect(Number(feePerKb)).to.equal(newFeePerKb);

      // Changing back the fee per kb
      await rskUtils.sendTxWithCheck(
        rskTxHelper,
        bridge.methods.voteFeePerKbChange(startingFeePerKb),
        FEE_PER_KB_CHANGER_ADDRESS,
        (result) => { expect(Number(result)).to.equal(1); }
      );

    }
    catch (err) {
      throw new CustomError('Should be able to vote ands change the fee per kb failure', err);
    }
  });
});
