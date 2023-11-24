const expect = require('chai').expect;
const {getBridge, getLatestActiveForkName} = require('../lib/precompiled-abi-forks-util');
const CustomError = require('../lib/CustomError');
const {getRskTransactionHelper} = require('../lib/rsk-tx-helper-provider');
const rskUtils = require('../lib/rsk-utils');
const {getBtcClient} = require('../lib/btc-client-provider');
const {disableWhitelisting} = require('../lib/2wp-utils');
const {MAX_ESTIMATED_FEE_PER_PEGOUT, FEE_DIFFERENCE_PER_PEGOUT} = require('../lib/constants');

const fulfillRequirementsToRunAsSingleTestFile = async (rskTxHelper, btcTxHelper) => {
  const latestForkName = rskUtils.getLatestForkName();
  await rskUtils.activateFork(latestForkName);
  await disableWhitelisting(rskTxHelper, btcTxHelper);
};

describe('getEstimatedFeesForNextPegOutEvent - last fork', () => {
  let bridge;

  before(async () => {
    const rskTxHelper = getRskTransactionHelper();
    const btcTxHelper = getBtcClient();
    if (process.env.RUNNING_SINGLE_TEST_FILE) {
      await fulfillRequirementsToRunAsSingleTestFile(rskTxHelper, btcTxHelper);
    }
    const latestActiveForkName = await getLatestActiveForkName();
    bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
  });

  it('getEstimatedFeesForNextPegOutEvent bridge method returns fee estimation for one pegout when there are no pegout requests', async () => {
    try {
      const count = Number(await bridge.methods.getQueuedPegoutsCount().call());
      const expectedCount = 0;
      expect(count).to.equal(expectedCount);

      const estimatedFees = Number(await bridge.methods.getEstimatedFeesForNextPegOutEvent().call());

      const expectedEstimatedFee = MAX_ESTIMATED_FEE_PER_PEGOUT - FEE_DIFFERENCE_PER_PEGOUT;
      expect(estimatedFees).to.equal(expectedEstimatedFee);
    } catch (err) {
      throw new CustomError('Error calling getEstimatedFeesForNextPegOutEvent', err);
    }
  });
});
