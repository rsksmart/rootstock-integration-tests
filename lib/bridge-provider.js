const { ethers } = require('ethers');
const precompiledAbis = require('@rsksmart/rsk-precompiled-abis');

/**
 * Returns a new bridge.
 * @param {import('ethers').JsonRpcProvider} rskClient
 * @returns {import('ethers').Contract} Bridge
 */
const getBridge = async (rskClient) => {
    return new ethers.Contract(
        precompiledAbis.bridge.address,
        precompiledAbis.bridge.abi,
        rskClient
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
