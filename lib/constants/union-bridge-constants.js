const { btcToWeis } = require("@rsksmart/btc-eth-unit-converter");
const { getBridgeStorageIndexFromLongKey } = require("../utils");

const UNION_BRIDGE_ADDRESS = '0x5988645D30cD01E4B3bC2c02CB3909dEC991Ae31';

// 400 RBTC initial locking cap
const INITIAL_LOCKING_CAP = btcToWeis(500);

const LOCKING_CAP_INCREMENTS_MULTIPLIER = 4;

// Change union bridge contract address authorizer public key
const CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK = 'fed88d227185baa8f5a2fcb6a671a6dde0ceadec433d2bba682835b8077c4052';

// Change locking cap authorizers public keys
const CHANGE_LOCKING_CAP_AUTHORIZERS_PKS = [
  'a2221797b4e6655bf39e8290d6db2c75536cf9ffb7f0d2bf4a7360f0b3716e5d',
  '3f610ba070777b0094155fb048c7c4b93ef823540650cc95faacdd060b32f033',
  '5f7f4cc8afa0313198aa651653d82c27b2530b15350c85eead8a44ce0ec981f1'
];

// Change transfer permissions authorizers public keys
const CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PKS = [
  'eb4d2e5d557125b17292785c718143829a8c08fad7faafb1b2705a2faf6b7872',
  '0bdc0631f861be1a5e65d4b15eef5d00084f920bfc80f306d93228858ab533f0',
  'f08cd8357d0077818970da11808ad6d8599555e388d5aa0a1e4cdd9571d21a8f'
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
  UNION_BRIDGE_CONTRACT_ADDRESS: getBridgeStorageIndexFromLongKey('unionBridgeContractAddress'),
  UNION_BRIDGE_LOCKING_CAP: getBridgeStorageIndexFromLongKey('unionBridgeLockingCap'),
  UNION_BRIDGE_INCREASE_LOCKING_CAP_ELECTION: getBridgeStorageIndexFromLongKey('unionBridgeIncreaseLockingCapElection'),
  WEIS_TRANSFERRED_TO_UNION_BRIDGE: getBridgeStorageIndexFromLongKey('weisTransferredToUnionBridge'),
  UNION_BRIDGE_REQUEST_ENABLED: getBridgeStorageIndexFromLongKey('unionBridgeRequestEnabled'),
  UNION_BRIDGE_RELEASE_ENABLED: getBridgeStorageIndexFromLongKey('unionBridgeReleaseEnabled'),
  UNION_BRIDGE_TRANSFER_PERMISSIONS_ELECTION: getBridgeStorageIndexFromLongKey('unionBridgeTransferPermissionsElection')
}

const UNION_RESPONSE_CODES = {
  SUCCESS: "0",
  UNAUTHORIZED_CALLER: "-1",
  // Response codes when the value specified is invalid:
  // 1. The requested amount of RBTC, combined with previously requested amounts, exceeds the current locking cap value.
  // 2. The returned amount exceeds the total amount of RBTC previously transferred.
  // 3. The new cap value is less than the current cap or excessive.
  INVALID_VALUE: "-2",
  // Response codes when request or release is disabled:
  REQUEST_DISABLED: "-3",
  RELEASE_DISABLED: "-3",
  // Environment restriction for preventing union bridge address being updated on production
  ENVIRONMENT_DISABLED: "-3",
  GENERIC_ERROR: "-10"
};


module.exports = {
  UNION_BRIDGE_ADDRESS,
  INITIAL_LOCKING_CAP,
  LOCKING_CAP_INCREMENTS_MULTIPLIER,
  CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
  CHANGE_LOCKING_CAP_AUTHORIZERS_PKS,
  CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PKS,
  UNION_BRIDGE_EVENTS,
  UNION_BRIDGE_STORAGE_INDICES,
  UNION_RESPONSE_CODES
};
