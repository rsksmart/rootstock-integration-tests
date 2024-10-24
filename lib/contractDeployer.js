
const fs = require('fs');
const path = require('path');
const { btcToWeis } = require('@rsksmart/btc-eth-unit-converter');
const solUtils = require('./sol-utils');
const TEST_RELEASE_BTC_CONTRACT = '../contracts/CallReleaseBtcContract.sol';
const TEST_RELEASE_BTC_CONTRACT_NAME = 'CallReleaseBtcContract';
const SOLIDITY_COMPILER_VERSION = 'v0.8.26+commit.8a97fa7a';
const { sendFromCow } = require('./rsk-utils');

const deployCallReleaseBtcContract = async (rskTxHelper) => {

    const address = await rskTxHelper.getClient().eth.personal.newAccount('');
    await sendFromCow(rskTxHelper, address, Number(btcToWeis(0.5)));
    await rskTxHelper.getClient().eth.personal.unlockAccount(address, '');
  
    const fullPath = path.resolve(__dirname, TEST_RELEASE_BTC_CONTRACT);
    const source = fs.readFileSync(fullPath).toString();
  
    const callReleaseBtcContract = await solUtils.compileAndDeploy(
      SOLIDITY_COMPILER_VERSION,
      source,
      TEST_RELEASE_BTC_CONTRACT_NAME,
      [],
      rskTxHelper,
      {
        from: address
      }
    );

    return {
        creatorAddress: address,
        callReleaseBtcContract,
    };
  
};

module.exports = {
    deployCallReleaseBtcContract,
};
