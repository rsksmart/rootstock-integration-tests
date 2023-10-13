const fs = require('fs');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');

const solUtils = require('../lib/sol-utils');
const rskUtils = require('../lib/rsk-utils');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');

const INITIAL_RSK_BALANCE_IN_BTC = 1;
const BRIDGE_ADDRESS = '0x0000000000000000000000000000000001000006';
const LIQUIDITY_BRIDGE_CONTRACT_FILE = './contracts/LBC.sol'; // Relative to tests root
const LIQUIDITY_BRIDGE_CONTRACT_NAME = 'LiquidityBridgeContractImpl';
const SOLIDITY_COMPILER_VERSION = 'v0.7.4+commit.3f05b770';

let contractInstance;

const deployLiquidityBridgeContract = async (host = null) => {
    const rskTransactionHelper = getRskTransactionHelper(host);
    const fromAddress = await rskTransactionHelper.newAccountWithSeed('');
    await rskUtils.sendFromCow(rskTransactionHelper, fromAddress, Number(btcEthUnitConverter.btcToWeis(INITIAL_RSK_BALANCE_IN_BTC)));
    await rskTransactionHelper.unlockAccount(fromAddress, '');
    
    try {
        const source = fs.readFileSync(LIQUIDITY_BRIDGE_CONTRACT_FILE).toString();
        const liquidityBridgeContract = await solUtils.compileAndDeploy(
            SOLIDITY_COMPILER_VERSION,
            source,
            LIQUIDITY_BRIDGE_CONTRACT_NAME,
            [BRIDGE_ADDRESS],
            rskTransactionHelper, {
                from: fromAddress
            }
        );

        return liquidityBridgeContract;
    } catch (err) {
        Promise.reject(err);
    }
}

const getLiquidityBridgeContract = async (host = null) => {
    if (!contractInstance) {
        contractInstance = await deployLiquidityBridgeContract(host);
    }

    // If there is a host provided override the provider
    if (host) {
        if(!host.startsWith('http') && !host.startsWith('https')){
            host = 'http://' + host;
          }
        contractInstance.setProvider(host);
    }

    return contractInstance;
}

const getDerivationHash = async (preHash, userBtcRefundAddress, liquidityProviderBtcAddress) => {
    let instance = await getLiquidityBridgeContract();
    let derivationHash = await instance.methods.getDerivationHash(preHash, userBtcRefundAddress, liquidityProviderBtcAddress).call();

    return derivationHash;
}

module.exports = { 
    getLiquidityBridgeContract,
    getDerivationHash
} 
