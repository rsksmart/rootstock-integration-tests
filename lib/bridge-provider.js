const precompiledAbisReed = require("@rsksmart/rsk-precompiled-abis-reed");

/**
 * Returns a new bridge.
 * @param {Web3} rskClient 
 * @returns {Bridge}
 */
const getBridge = async (rskClient) => {
    return new rskClient.eth.Contract(precompiledAbisReed.bridge.abi, precompiledAbisReed.bridge.address);
};

/**
 * Returns the abi of the bridge for the latest fork.
 * @returns {json} The bridge abi in json format
 */
const getBridgeAbi = async () => {
    return precompiledAbisReed.bridge.abi;
};

module.exports = {
    getBridge,
    getBridgeAbi,
};
