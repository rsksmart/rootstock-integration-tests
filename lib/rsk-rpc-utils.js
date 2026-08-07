/**
 * Calls the RSK-specific `rsk_getStorageBytesAt` JSON-RPC method, which reads raw storage bytes
 * (as opposed to the single 32-byte word the standard `eth_getStorageAt` returns).
 * @param {import('ethers').JsonRpcProvider} client
 * @param {string} address the contract address to read storage from
 * @param {string} storageIndex the storage index/key, as a 0x-prefixed hex string
 * @param {string|number} blockNumber defaults to 'latest'
 * @returns {Promise<string>} the storage value, RLP-encoded as a 0x-prefixed hex string
 */
const getStorageBytesAt = (client, address, storageIndex, blockNumber = 'latest') => {
    return client.send('rsk_getStorageBytesAt', [address, storageIndex, blockNumber]);
};

module.exports = {
    getStorageBytesAt,
};
