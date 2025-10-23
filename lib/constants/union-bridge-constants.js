const { btcToWeis } = require("@rsksmart/btc-eth-unit-converter");
const { getBridgeStorageIndexFromLongKey } = require("../utils");

const UNION_BRIDGE_ADDRESS = '0x0000000000000000000000000000000000000000';

// 400 RBTC initial locking cap
const INITIAL_LOCKING_CAP = btcToWeis(200);

const LOCKING_CAP_INCREMENTS_MULTIPLIER = 2;

// Change union bridge contract address authorizer public key
const CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK = '7880a81a4591568b0e87947e5150fe8e330091678654f3bc661b516f91a5f00a';

// Change locking cap authorizers public keys
const CHANGE_LOCKING_CAP_AUTHORIZERS_PKS = [
  'a2221797b4e6655bf39e8290d6db2c75536cf9ffb7f0d2bf4a7360f0b3716e5d'
];

// Change transfer permissions authorizers public keys
const CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PKS = [
  '03918409b6d508f31d72879df0813a6d60d8c74eb91197572c9f3df1da9ae5a5'
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
