
const orchidPrecompiled = require("precompiled-orchid");
const wasabi100Precompiled = require("precompiled-wasabi100");
const papyrus200Precompiled = require("precompiled-papyrus200");
const iris300Precompiled = require("precompiled-iris300");
const hop400Precompiled = require("precompiled-hop400");
const precompiledFingerroot500 = require("precompiled-fingerroot500");
const precompiledArrowhead600 = require("precompiled-arrowhead600");
const precompiledLovell700 = require("precompiled-lovell700");

const ORCHID = 'orchid';
const WASABI = 'wasabi';
const PAPYRUS = 'papyrus';
const IRIS = 'iris';
const HOP = 'hop';
const HOP401 = 'hop401';
const FINGERROOT = 'fingerroot';
const ARROWHEAD = 'arrowhead';
const LOVELL = 'lovell';

// Map to access the pre fork names of certain fork in constant time O(1)
const preForkMap = {
    [ORCHID]: ORCHID, // orchid pre is itself
    [WASABI]: ORCHID,
    [PAPYRUS]: WASABI,
    [IRIS]: PAPYRUS,
    [HOP]: IRIS,
    [HOP401]: HOP,
    [FINGERROOT]: HOP401,
    [ARROWHEAD]: FINGERROOT,
    [LOVELL]: ARROWHEAD
}

const cache = new Map();

/**
 * Creates a bridge instance for the given fork name. If no fork name is provided, then the latest bridge is returned.
 * The bridge instance is cached using the forkname for future use.
 * @param {Web3} rskClient 
 * @param {string} forkName 
 * @returns {Bridge}
 */
const getBridge = (rskClient, forkName = '') => {

    const { orchid, wasabi100, papyrus200, iris300, hop400, hop401, fingerroot500, arrowhead600, lovell700 } = Runners.common.forks;
    if(cache.has(forkName)) {
        return cache.get(forkName);
    }

    let bridge;
    switch(forkName) {
        case lovell700.name:
            bridge = precompiledLovell700.bridge.build(rskClient);
            break;
        case arrowhead600.name:
            bridge = precompiledArrowhead600.bridge.build(rskClient);
            break;
        case fingerroot500.name:
            bridge = precompiledFingerroot500.bridge.build(rskClient);
            break;
        case hop400.name:
        case hop401.name:
            bridge = hop400Precompiled.bridge.build(rskClient);
            break;
        case iris300.name:
            bridge = iris300Precompiled.bridge.build(rskClient);
            break;
        case papyrus200.name:
            bridge = papyrus200Precompiled.bridge.build(rskClient);
            break;
        case wasabi100.name:
            bridge = wasabi100Precompiled.bridge.build(rskClient);
            break;
        case orchid.name:
            bridge = orchidPrecompiled.bridge.build(rskClient);
            break;
         default:
            // return latest bridge
            bridge = precompiledLovell700.bridge.build(rskClient);
    }
    cache.set(forkName, bridge);
    return bridge;
}

/**
 * Returns the abi of the bridge for the given fork name. If no fork name is provided, then the latest bridge abi is returned.
 * @param {string} forkName 
 * @returns {json} The bridge abi in json format
 */
const getBridgeAbi = (forkName) => {

    const { orchid, wasabi100, papyrus200, iris300, hop400, hop401, fingerroot500, arrowhead600, lovell700 } = Runners.common.forks;
    switch(forkName) {
        case lovell700.name:
            return precompiledLovell700.bridge.abi;
        case arrowhead600.name:
            return precompiledArrowhead600.bridge.abi;
        case fingerroot500.name:
            return precompiledFingerroot500.bridge.abi;
        case hop400.name:
        case hop401.name:
            return hop400Precompiled.bridge.abi;
        case iris300.name:
            return iris300Precompiled.bridge.abi;
        case papyrus200.name:
            return papyrus200Precompiled.bridge.abi;
        case wasabi100.name:
            return wasabi100Precompiled.bridge.abi;
        case orchid.name:
            return orchidPrecompiled.bridge.abi;
        default:
            // return latest abi
            return precompiledArrowhead600.bridge.abi;
    }
};

/**
 * Returns the name of the fork right before the given `currentForkName`
 * @param {string} currentForkName 
 * @returns {string} The name of the fork right before the given `currentForkName`
 */
const getPreForkName = (currentForkName) => {
    return preForkMap[currentForkName];
}

/**
 * Returns the most recent activated fork name
 * @returns {Promise<string>} the most recent activated fork name
 */
const getLatestActiveForkName = async () => {
    const forks = Object.values(Runners.common.forks);
    for(let i = forks.length - 1; i > -1; i--) {
        const fork = forks[i];
        const isForkAlreadyActive = await fork.isAlreadyActive();
        if(isForkAlreadyActive) {
            return fork.name;
        }
    }
    return Runners.common.forks.orchid.name;
};

module.exports = {
    getBridge,
    getBridgeAbi,
    getLatestActiveForkName,
    getPreForkName,
};
