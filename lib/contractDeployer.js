
const fs = require('fs');
const path = require('path');
const solUtils = require('./sol-utils');
const TEST_RELEASE_BTC_CONTRACT = '../contracts/CallReleaseBtcContract.sol';
const TEST_RELEASE_BTC_CONTRACT_NAME = 'CallReleaseBtcContract';
const SOLIDITY_COMPILER_VERSION = 'v0.8.26+commit.8a97fa7a';

/**
 * Deploys the CallReleaseBtcContract contract.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} from the funded rsk address from which the contract will be deployed.
 * @returns {Promise<Contract>} the deployed contract.
 */
const deployCallReleaseBtcContract = async (rskTxHelper, from) => {
  
    const fullPath = path.resolve(__dirname, TEST_RELEASE_BTC_CONTRACT);
    const source = fs.readFileSync(fullPath).toString();
  
    const callReleaseBtcContract = await solUtils.compileAndDeploy(
      SOLIDITY_COMPILER_VERSION,
      source,
      TEST_RELEASE_BTC_CONTRACT_NAME,
      [],
      rskTxHelper,
      {
        from
      }
    );

    return callReleaseBtcContract;
  
};

module.exports = {
    deployCallReleaseBtcContract,
};
