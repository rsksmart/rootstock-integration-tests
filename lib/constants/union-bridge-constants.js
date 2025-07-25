const {btcToWeis } = require("@rsksmart/btc-eth-unit-converter");
const {getBridgeStorageIndexFromKey} = require("../utils");

const UNION_BRIDGE_ADDRESS = '5988645d30cd01e4b3bc2c02cb3909dec991ae31';

// 400 RBTC initial locking cap
const INITIAL_LOCKING_CAP = btcToWeis(400);

const LOCKING_CAP_INCREMENTS_MULTIPLIER = 3;

// Change union bridge contract address authorizer public key
const CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PUBKEY = '041fb6d4b421bb14d95b6fb79823d45b777f0e8fd07fe18d0940c0c113d9667911e354d4e8c8073f198d7ae5867d86e3068caff4f6bd7bffccc6757a3d7ee8024a';

// Change locking cap authorizers public keys
const CHANGE_LOCKING_CAP_AUTHORIZERS_PUBKEYS = [
  '049929eb3c107a65108830f4c221068f42301bd8b054f91bd594944e7fb488fd1c93a8921fb28d3494769598eb271cd2834a31c5bd08fa075170b3da804db00a5b',
  '04c8a5827bfadd2bce6fa782e6c48dd61503d38c86e29381781167cd6371eb56f50bc03c9e9c265ea7e07709b964e0b4b0f3d416955225fcb9202e6763ddd5ca91',
  '0442329d63de5ec5b2f285da7e2f3eb484db3ee5e39066579244211021b81c32d7061922075e2272a8e8a633a5856071eef7e7f800b3d93c9acee91e0f0f37ac2f'
];

// Change transfer permissions authorizers public keys
const CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PUBKEYS = [
  '04ea24f3943dff3b9b8abc59dbdf1bd2c80ec5b61f5c2c6dfcdc189299115d6d567df34c52b7e678cc9934f4d3d5491b6e53fa41a32f58a71200396f1e11917e8f',
  '04cf42ec9eb287adc7196e8d3d2c288542b1db733681c22887e3a3e31eb98504002825ecbe0cd9b61aff3600ffd0ca4542094c75cb0bac5e93be0c7e00b2ead9ea',
  '043a7510e39f8c406fb682c20d0e74e6f18f6ec6cb4bc9718a3c47f9bda741f3333ed39e9854b9ad89f16fccb52453975ff1039dd913addfa6a6c56bcacbd92ff9'
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
  CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PUBKEY,
  CHANGE_LOCKING_CAP_AUTHORIZERS_PUBKEYS,
  CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PUBKEYS,
  UNION_BRIDGE_EVENTS,
  UNION_BRIDGE_STORAGE_INDICES,
  UNION_RESPONSE_CODES
};
