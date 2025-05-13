const precompiledAbisLovell = require("@rsksmart/rsk-precompiled-abis-lovell");
const Web3 = require("web3");

/**
 * Returns a new bridge.
 * @param {Web3} rskClient 
 * @returns {Bridge}
 */
const getBridge = async (rskClient) => {
    return new rskClient.eth.Contract(precompiledAbisLovell.bridge.abi, precompiledAbisLovell.bridge.address);
};

/**
 * Returns the abi of the bridge for the latest fork.
 * @returns {json} The bridge abi in json format
 */
const getBridgeAbi = async () => {
    return precompiledAbisLovell.bridge.abi;
};

module.exports = {
    getBridge,
    getBridgeAbi,
};
