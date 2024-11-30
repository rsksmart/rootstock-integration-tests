const precompiledArrowhead600 = require("@rsksmart/rsk-precompiled-abis");

let bridgeCache;

/**
 * Returns a bridge instance and caches it.
 * @param {Web3} rskClient 
 * @returns {Bridge}
 */
const getBridge = (rskClient) => {

    if(bridgeCache) {
        return bridgeCache;
    }

    bridgeCache = precompiledArrowhead600.bridge.build(rskClient);

    return bridgeCache;
}

/**
 * Returns the abi of the bridge for the latest fork.
 * @returns {json} The bridge abi in json format
 */
const getBridgeAbi = () => {
    return precompiledArrowhead600.bridge.abi;
};

module.exports = {
    getBridge,
    getBridgeAbi,
};
