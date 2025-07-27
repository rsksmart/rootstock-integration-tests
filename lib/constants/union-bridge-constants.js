const {btcToWeis } = require("@rsksmart/btc-eth-unit-converter");
const {getBridgeStorageIndexFromKey} = require("../utils");

const UNION_BRIDGE_ADDRESS = '0x5988645D30cD01E4B3bC2c02CB3909dEC991Ae31';

// 400 RBTC initial locking cap
const INITIAL_LOCKING_CAP = btcToWeis(500);

const LOCKING_CAP_INCREMENTS_MULTIPLIER = 3;

// Change union bridge contract address authorizer public key
const CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK = 'fed88d227185baa8f5a2fcb6a671a6dde0ceadec433d2bba682835b8077c4052';

// Change locking cap authorizers public keys
const CHANGE_LOCKING_CAP_AUTHORIZERS_PKs = [
  'a2221797b4e6655bf39e8290d6db2c75536cf9ffb7f0d2bf4a7360f0b3716e5d',
  '3f610ba070777b0094155fb048c7c4b93ef823540650cc95faacdd060b32f033',
  '5f7f4cc8afa0313198aa651653d82c27b2530b15350c85eead8a44ce0ec981f1'
];

// Change transfer permissions authorizers public keys
const CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PUBKEYS = [
  'ee1ec7d822b8ed0ce46377fc39071cfc66295db9ec577706e530a01254a71d31',
  'eed30d01515d48b7c576672909a708946d8d26cfe35e1ae3c2b1332007b94142',
  'fd5b26cc20392ed6d4200c0fbff6bd8ee44c341c7d75de3585f501d49b76858a'
];

const UNION_BRIDGE_EVENTS = {
  UNION_LOCKING_CAP_INCREASED: {
    name: 'union_bridge_locking_cap_increased'
  },
  UNION_RBTC_REQUESTED: {
    name: 'union_rbtc_requested'
  },
  UNION_RBTC_RELEASED: {
    name: 'union_rbtc_released'
  },
  UNION_BRIDGE_TRANSFER_PERMISSIONS_UPDATED: {
    name: 'union_bridge_transfer_permissions_updated'
  }
};

const UNION_BRIDGE_STORAGE_INDICES = {
  UNION_BRIDGE_CONTRACT_ADDRESS: getBridgeStorageIndexFromKey('unionBridgeContractAddress'),
  UNION_BRIDGE_LOCKING_CAP: getBridgeStorageIndexFromKey('unionBridgeLockingCap'),
  UNION_BRIDGE_INCREASE_LOCKING_CAP_ELECTION: getBridgeStorageIndexFromKey('unionBridgeIncreaseLockingCapElection'),
  WEIS_TRANSFERRED_TO_UNION_BRIDGE: getBridgeStorageIndexFromKey('weisTransferredToUnionBridge'),
  UNION_BRIDGE_REQUEST_ENABLED: getBridgeStorageIndexFromKey('unionBridgeRequestEnabled'),
  UNION_BRIDGE_RELEASE_ENABLED: getBridgeStorageIndexFromKey('unionBridgeReleaseEnabled'),
  UNION_BRIDGE_TRANSFER_PERMISSIONS_ELECTION: getBridgeStorageIndexFromKey('unionBridgeTransferPermissionsElection')
}

const UNION_RESPONSE_CODES = {
  SUCCESS: 0,
  UNAUTHORIZED_CALLER: -1,
  // Response codes when the value specified is invalid:
  // 1. The requested amount of RBTC, combined with previously requested amounts, exceeds the current locking cap value.
  // 2. The returned amount exceeds the total amount of RBTC previously transferred.
  // 3. The new cap value is less than the current cap or excessive.
  INVALID_VALUE: -2,
  // Response codes when request or release is disabled:
  REQUEST_DISABLED: -3,
  RELEASE_DISABLED: -3,
  // Environment restriction for preventing union bridge address being updated on production
  ENVIRONMENT_DISABLED: -3,
  GENERIC_ERROR: -10
};


module.exports = {
  UNION_BRIDGE_ADDRESS,
  INITIAL_LOCKING_CAP,
  LOCKING_CAP_INCREMENTS_MULTIPLIER,
  CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PUBKEY: CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
  CHANGE_LOCKING_CAP_AUTHORIZERS_PUBKEYS: CHANGE_LOCKING_CAP_AUTHORIZERS_PKs,
  CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PUBKEYS,
  UNION_BRIDGE_EVENTS,
  UNION_BRIDGE_STORAGE_INDICES,
  UNION_RESPONSE_CODES
};
