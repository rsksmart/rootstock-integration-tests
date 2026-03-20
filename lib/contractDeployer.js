const fs = require('node:fs');
const path = require('node:path');
const solUtils = require('./sol-utils');
const TEST_RELEASE_BTC_CONTRACT = '../contracts/CallReleaseBtcContract.sol';
const TEST_RELEASE_BTC_CONTRACT_NAME = 'CallReleaseBtcContract';

const TEST_UNION_BRIDGE_CONTRACT = '../contracts/UnionBridgeContract.sol';
const TEST_UNION_BRIDGE_CONTRACT_NAME = 'UnionBridgeContract';

const TEST_UNION_BRIDGE_AUTHORIZER_CONTRACT = '../contracts/UnionBridgeAuthorizer.sol';
const TEST_UNION_BRIDGE_AUTHORIZER_CONTRACT_NAME = 'UnionBridgeAuthorizer';

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
            from,
        }
    );
};

/**
 * Deploys the unionBridgeContract contract.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} from the funded rsk address from which the contract will be deployed.
 * @returns {Promise<Contract>} the deployed contract.
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
            from,
        }
    );
};

/**
 * Deploys the UnionBridgeAuthorizer contract.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} from the funded rsk address from which the contract will be deployed.
 * @returns {Promise<Contract>} the deployed contract.
 */
const deployUnionBridgeAuthorizerContract = async (rskTxHelper, from) => {
    const fullPath = path.resolve(__dirname, TEST_UNION_BRIDGE_AUTHORIZER_CONTRACT);
    const source = fs.readFileSync(fullPath).toString();

    return await solUtils.compileAndDeploy(
        SOLIDITY_COMPILER_VERSION,
        source,
        TEST_UNION_BRIDGE_AUTHORIZER_CONTRACT_NAME,
        [],
        rskTxHelper,
        {
            from: from,
            gas: '3000000',
        }
    );
};

module.exports = {
    deployCallReleaseBtcContract,
    deployUnionBridgeContract,
    deployUnionBridgeAuthorizerContract,
};
