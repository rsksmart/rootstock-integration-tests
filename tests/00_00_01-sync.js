const { wait } = require('../lib/utils');
const CustomError = require('../lib/CustomError');
const rskUtils = require('../lib/rsk-utils');
const { expect, assert } = require('chai');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

const { promisify } = require('util');
const { exec } = require('child_process');

const execPromise = promisify(exec);

const WAIT_IN_MILLISECONDS = 5000;

describe('Federators sync', () => {

  it('should sync all rsk federator nodes when one of them manually mines', async () => {

    const { stdout, stderr } = await execPromise('docker --version');

    console.log('docker installation response: ', stdout);
    console.log('docker installation response stderr: ', stderr);

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
