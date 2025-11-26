const fs = require('fs');
const path = require('path');
const solUtils = require('./sol-utils');
const TEST_RELEASE_BTC_CONTRACT = '../contracts/CallReleaseBtcContract.sol';
const TEST_RELEASE_BTC_CONTRACT_NAME = 'CallReleaseBtcContract';

const TEST_UNION_BRIDGE_CONTRACT = '../contracts/UnionBridgeContract.sol';
const TEST_UNION_BRIDGE_CONTRACT_NAME = 'UnionBridgeContract';

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

  return await solUtils.compileAndDeploy(
      SOLIDITY_COMPILER_VERSION,
      source,
      TEST_RELEASE_BTC_CONTRACT_NAME,
      [],
      rskTxHelper,
      {
          from
      }
    );
  
};

/**
 * Deploys the unionBridgeContract contract.
 * @param rskTxHelper
 * @param from the funded rsk address from which the contract will be deployed.
 * @returns {Promise<*>} the deployed contract.
 */
const deployUnionBridgeContract = async (rskTxHelper, from) => {
    const fullPath = path.resolve(__dirname, TEST_UNION_BRIDGE_CONTRACT);
    const source = fs.readFileSync(fullPath).toString();

    return await solUtils.compileAndDeploy(
      SOLIDITY_COMPILER_VERSION,
      source,
      TEST_UNION_BRIDGE_CONTRACT_NAME,
      [],
      rskTxHelper,
      {
          from
      }
    );
}

module.exports = {
    deployCallReleaseBtcContract,
    deployUnionBridgeContract
};
