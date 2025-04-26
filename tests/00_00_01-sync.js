const { wait } = require('../lib/utils');
const CustomError = require('../lib/CustomError');
const rskUtils = require('../lib/rsk-utils');
const { expect, assert } = require('chai');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

const {
  startTcpsignerInstance,
  stopTcpsignerInstance,
  stopAllTcpsignerInstances,
} = require('../lib/tcpsigner-runner');


const WAIT_IN_MILLISECONDS = 5000;

describe('Federators sync', () => {

  before(async () => {

    // TODO: remove this. This is just for testing purposes.
    startTcpsignerInstance('federator1', 9991, ['-c0xf98c614b921913a70d36a68512e1bf3717a6ede3e05b9d1ab1fd8ba7bd0e9842', '--difficulty=0x03']);
    startTcpsignerInstance('federator2', 9995, ['-c0xf98c614b921913a70d36a68512e1bf3717a6ede3e05b9d1ab1fd8ba7bd0e9843', '--difficulty=0x05']);

  });

  it('should sync all rsk federator nodes when one of them manually mines', async () => {
    try {
      await wait(WAIT_IN_MILLISECONDS);
      expect(Runners.hosts.federates.length).to.be.greaterThan(0, 'Federates array cannot be empty');
      const rskTransactionHelpers = getRskTransactionHelpers();

      const blocksToMine = 20;
      
      // Should mine and sync all the fed nodes and return the latest block number for each fed
      const federatorsLatestBlocks = await rskUtils.mineAndSync(rskTransactionHelpers, blocksToMine);
      const allFederatorsAreSynched = federatorsLatestBlocks.every(blockNumber => blockNumber === blocksToMine);
      assert.isTrue(allFederatorsAreSynched, 'The federators are not synced');
    } catch (err) {
      throw new CustomError('Manually mining failure', err);
    }
  });
});
