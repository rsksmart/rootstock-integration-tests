const { expect } = require('chai');
const rskUtils = require('../rsk-utils');
const CustomError = require('../CustomError');
const { getRskTransactionHelpers } = require('../rsk-tx-helper-provider');

const execute = (fork) => {
  
  // Unskip when there is a new fork to be tested pre and post.
  describe.skip(`Activate ${fork.name} fork`, () => {

      it(`should mine blocks until reach ${fork.activationHeight}th block in order to activate the fork`, async () => {
        try {
          const rskTransactionHelpers = getRskTransactionHelpers();
          const currentBlockNumber = await rskTransactionHelpers[0].getBlockNumber();
          expect(currentBlockNumber).to.be.below(fork.activationHeight);
          
          // Mine until activation block plus one
          const expectedHeight = fork.activationHeight + 1;
          const blocksToMine = expectedHeight - currentBlockNumber;
          await rskUtils.mineAndSync(rskTransactionHelpers, blocksToMine);
          const isForkAlreadyActive = await fork.isAlreadyActive();
          expect(isForkAlreadyActive, `Fork ${fork.name} not yet active`).to.be.true;
        } catch (err) {
          throw new CustomError('Block mining until reach height to activate fork failure', err);
        }
      });
  });
}

module.exports = { execute };
