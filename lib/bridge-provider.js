const precompiledAbisArrowhead = require("@rsksmart/rsk-precompiled-abis");
const precompiledAbisLovell = require("@rsksmart/rsk-precompiled-abis-lovell");
const Web3 = require("web3");

/**
 * Returns a new bridge.
 * @param {Web3} rskClient 
 * @returns {Bridge}
 */
const getBridge = async (rskClient) => {

    const isLovellActive = await Runners.common.forks.lovell700.isAlreadyActive();

    if(isLovellActive) {
        return new rskClient.eth.Contract(precompiledAbisLovell.bridge.abi, precompiledAbisLovell.bridge.address);
    }
   
    return new rskClient.eth.Contract(precompiledAbisArrowhead.bridge.abi, precompiledAbisArrowhead.bridge.address);
};

/**
 * Returns the abi of the bridge for the latest fork.
 * @returns {json} The bridge abi in json format
 */
const getBridgeAbi = async () => {
    const isLovellActive = await Runners.common.forks.lovell700.isAlreadyActive();
    if(isLovellActive) {
        return precompiledAbisLovell.bridge.abi;
    }
    return precompiledAbisArrowhead.bridge.abi;
};

module.exports = {
    getBridge,
    getBridgeAbi,
};
