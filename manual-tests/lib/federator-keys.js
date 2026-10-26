/**
 * The fixed pool of federator keys the manual scenarios draw from.
 *
 * One private key per federator is all that is needed: the BTC, RSK and MST signing keys are the
 * same key (as they are in the regular regtest configs), the node's `peer.privateKey` is that key
 * too, and the node id is just its uncompressed public key without the format prefix. So the only
 * thing hardcoded here is the list below; everything else is derived.
 *
 * The first three keys are not a free choice: rskj's regtest genesis federation is hardcoded in
 * `BridgeRegTestConstants.DEFAULT_FEDERATION_PUBLIC_KEYS`, and the Bridge will only recognise a
 * genesis federator whose public key is one of those three. They are the same keys the regular
 * regtest configs use under `config/node-keys/genesis-federation/`.
 *
 * Keys 4 to 12 are the ones the regular regtest configs already carry for the second, third and
 * fourth federations. Keys 13 to 20 were generated for these scenarios as
 * sha256('rootstock-integration-tests/manual-tests/federation-growth/federator-<n>'), so anybody
 * can regenerate and check them.
 *
 * These are throwaway regtest keys and nothing else. They are public in this repository on
 * purpose, the same way the existing node keys are.
 */
const ECPairFactory = require('ecpair').default;
const ecc = require('tiny-secp256k1');

const ECPair = ECPairFactory(ecc);

// The maximum OP_CHECKMULTISIG supports, which is also the largest powpeg the Bridge can build.
const MAX_FEDERATORS_COUNT = 20;

const FEDERATOR_PRIVATE_KEYS = [
    // 1 to 3: rskj's regtest genesis federation. Do not reorder or replace these.
    '45c5b07fc1a6f58892615b7c31dca6c96db58c4bbc538a6b8a22999aaa860c32',
    '505334c7745df2fc61486dffb900784505776a898377172ffa77384892749179',
    'bed0af2ce8aa8cb2bc3f9416c9d518fdee15d1ff15b8ded28376fcb23db6db69',
    // 4 to 12: the second, third and fourth federations of the regular regtest configs.
    '214bfe85db3fe3154fe149731e5816b762e909029c1d5d76e9214e986da0d392',
    'cb0878d04ae1d7d30df5866f845467b1d3ead5116b7732b894d69b89dc90f03a',
    '88f1707bedd8afc8314035b2a8334bc5d6e6644aaf9b94e89cb5e27e9dc34367',
    '0c6768b0905fa1ff4a63313a6e61e89e6bb0a511b44ec5a449921b24abfa1b4f',
    '7e878d8199b6e7159aa79fa8077c5e8129b1bd6ce1cd5016dfd568d9944a0a06',
    'e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4',
    'e1910f6fe9f6dc6bf995a80aadb32f860d1103cd415fe5ff716c8e70d74b19bb',
    'f98f0f65c83e50dee8db45975a443a915b289bd916473910059111a226b0495b',
    '9dd9e22f9ea340a9818a21dd32ce937a61b7dc26f019cd36138098f5d7985574',
    // 13 to 20: generated for the manual scenarios, see the note above.
    '01c790dbd5bc076fcf781c2189e50029100bd3c563ccdd2387a9da2dfe31af7d',
    'f4a06d07f9262c1d853929c59a2e477647f338d4aff50b695b6e3859ad002aa7',
    'ffb97b1bcfe37d94c24d5c7a0e8fa95d25b509f08c2b4d9f366500c1cb2528e8',
    'c2a0b003e15c1c9123985d1cca6f52b5f9dd0b9b4a60cb294cf4e44532b49591',
    '9c4fd6d9dc790f16d5e64849cfd7208735568c64567ea3be14e3e4b3b930279e',
    '8fbddf7c55736fefa1bd5415fedd9a958af8af659511701d7f34285e3c688641',
    'de6f58559e63d5101f07c1ebdb6a2ba612d5d8a2cd6a44bddc27932a1579337d',
    '677f1275acb7c41af5f49b0f89a1ab61ec348aa80039b3359260ba785fdb838f',
];

// The three rskj hardcodes for the regtest genesis federation, kept here so the derivation of the
// first three keys can be checked against them instead of being taken on trust.
const GENESIS_FEDERATION_PUBLIC_KEYS = [
    '0362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a124',
    '03c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db',
    '02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
];

/**
 * Derives everything a federator needs from its private key.
 * @param {string} privateKey 32 bytes of hex, without the 0x prefix
 * @param {number} federatorNumber 1 based, only used for the federator's name
 * @returns {{number: number, name: string, privateKey: string, publicKey: string, nodeId: string}}
 */
const deriveFederator = (privateKey, federatorNumber) => {
    const privateKeyBuffer = Buffer.from(privateKey, 'hex');
    const compressedPublicKey = Buffer.from(
        ECPair.fromPrivateKey(privateKeyBuffer, { compressed: true }).publicKey
    ).toString('hex');
    const uncompressedPublicKey = Buffer.from(
        ECPair.fromPrivateKey(privateKeyBuffer, { compressed: false }).publicKey
    ).toString('hex');

    return {
        number: federatorNumber,
        name: `fed${federatorNumber}`,
        privateKey,
        publicKey: compressedPublicKey,
        // rskj's node id is the uncompressed public key without its leading 0x04 format byte.
        nodeId: uncompressedPublicKey.slice(2),
    };
};

const FEDERATORS = FEDERATOR_PRIVATE_KEYS.map((privateKey, index) =>
    deriveFederator(privateKey, index + 1)
);

/**
 * The first `federatorsCount` federators of the pool.
 * @param {number} federatorsCount
 * @returns {Array<object>}
 */
const getFederators = (federatorsCount) => {
    if (!Number.isInteger(federatorsCount) || federatorsCount < 1) {
        throw new Error(`federatorsCount must be a positive integer, got ${federatorsCount}`);
    }
    if (federatorsCount > FEDERATORS.length) {
        throw new Error(
            `Only ${FEDERATORS.length} federator keys are available, ${federatorsCount} were requested`
        );
    }
    return FEDERATORS.slice(0, federatorsCount);
};

/**
 * The amount of signatures a powpeg of the given size needs: half plus one. This is consensus
 * code in the Bridge and does not change.
 * @param {number} federatorsCount
 * @returns {number}
 */
const getRequiredSignaturesCount = (federatorsCount) => Math.floor(federatorsCount / 2) + 1;

module.exports = {
    MAX_FEDERATORS_COUNT,
    GENESIS_FEDERATION_PUBLIC_KEYS,
    FEDERATORS,
    getFederators,
    getRequiredSignaturesCount,
};
