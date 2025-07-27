const fs = require('fs');
const path = require('path');
const solUtils = require('./sol-utils');
const TEST_RELEASE_BTC_CONTRACT = '../contracts/CallReleaseBtcContract.sol';
const TEST_RELEASE_BTC_CONTRACT_NAME = 'CallReleaseBtcContract';

const TEST_UNION_BRIDGE_METHODS_CONTRACT = '../contracts/CallUnionBridgeMethodsContract.sol';
const TEST_UNION_BRIDGE_METHODS_CONTRACT_NAME = 'CallUnionBridgeMethodsContract';

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

/**
 * Deploys the CallUnionBridgeMethods contract.
 * @param rskTxHelper
 * @param from the funded rsk address from which the contract will be deployed.
 * @returns {Promise<*>} the deployed contract.
 */
const deployCallUnionBridgeMethodsContract = async (rskTxHelper, from) => {
    const fullPath = path.resolve(__dirname, TEST_UNION_BRIDGE_METHODS_CONTRACT);
    const source = fs.readFileSync(fullPath).toString();

    const callUnionBridgeMethodsContract = await solUtils.compileAndDeploy(
      SOLIDITY_COMPILER_VERSION,
      source,
      TEST_UNION_BRIDGE_METHODS_CONTRACT_NAME,
      [],
      rskTxHelper,
      {
        from
      }
    );

    return callUnionBridgeMethodsContract;
}

module.exports = {
    deployCallReleaseBtcContract,
    deployCallUnionBridgeMethodsContract
};
