const precompiledAbis = require('@rsksmart/rsk-precompiled-abis');
const Web3 = require('web3');

/**
 * Returns a new bridge.
 * @param {Web3} rskClient
 * @returns {Bridge}
 */
const getBridge = async (rskClient) => {
    return new rskClient.eth.Contract(
        precompiledAbis.bridge.abi,
        precompiledAbis.bridge.address
    );
};

/**
 * Returns the abi of the bridge for the latest fork.
 * @returns {json} The bridge abi in json format
 */
const getBridgeAbi = async () => {
    return precompiledAbis.bridge.abi;
};

module.exports = {
    getBridge,
    getBridgeAbi,
};
