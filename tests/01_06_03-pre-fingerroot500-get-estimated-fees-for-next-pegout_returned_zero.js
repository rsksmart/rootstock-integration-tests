const expect = require('chai').expect;
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const CustomError = require('../lib/CustomError');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');

let bridge;

describe('getEstimatedFeesForNextPegOutEvent - pre fingerroot', () => {
    before(async () => {
      const rskTxHelper = getRskTransactionHelper();
      const latestActiveForkName = await getLatestActiveForkName();
      bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
    });

  it('getEstimatedFeesForNextPegOutEvent bridge method returns zero when there are no pegout requests', async () => {
    try {
      const count = Number(await bridge.methods.getQueuedPegoutsCount().call());
      const expectedCount = 0;
      expect(count).to.equal(expectedCount);

      const estimatedFees = Number(await bridge.methods.getEstimatedFeesForNextPegOutEvent().call());

      const expectedEstimatedFee = 0;
      expect(estimatedFees).to.equal(expectedEstimatedFee);
    } catch (err) {
      throw new CustomError('Error calling getEstimatedFeesForNextPegOutEvent', err);
    }
  });
});
