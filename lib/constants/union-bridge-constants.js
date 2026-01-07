const {btcToWeis} = require("@rsksmart/btc-eth-unit-converter");
const {getBridgeStorageIndexFromLongKey} = require("../utils");

const INITIAL_UNION_BRIDGE_ADDRESS = '0x0000000000000000000000000000000000000000';

const INITIAL_UNION_LOCKING_CAP = btcToWeis(1);

const UNION_LOCKING_CAP_INCREMENTS_MULTIPLIER = 2;

const CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK = '7880a81a4591568b0e87947e5150fe8e330091678654f3bc661b516f91a5f00a';

// UnionBridgeAuthorizer multisig members
// seed: UnionBridgeAuthorizer1
const UNION_BRIDGE_AUTHORIZER_1_PK = "a2221797b4e6655bf39e8290d6db2c75536cf9ffb7f0d2bf4a7360f0b3716e5d";
// seed: UnionBridgeAuthorizer2
const UNION_BRIDGE_AUTHORIZER_2_PK = "1769b8128e7eb24d632122e03d64c8cd525cf2cf3d2d00190039918666106282";
// seed: UnionBridgeAuthorizer3
const UNION_BRIDGE_AUTHORIZER_3_PK = "03918409b6d508f31d72879df0813a6d60d8c74eb91197572c9f3df1da9ae5a5";

// seed: UnionBridgeAuthorizerDeployer
const UNION_BRIDGE_AUTHORIZER_DEPLOYER_PK = "b00e82a2aa449171e750e9ccc945ee710d438dbaba1d6410aa781121f1f13099";

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
  WEIS_TRANSFERRED_TO_UNION_BRIDGE: getBridgeStorageIndexFromLongKey('weisTransferredToUnionBridge'),
  UNION_BRIDGE_REQUEST_ENABLED: getBridgeStorageIndexFromLongKey('unionBridgeRequestEnabled'),
  UNION_BRIDGE_RELEASE_ENABLED: getBridgeStorageIndexFromLongKey('unionBridgeReleaseEnabled')
}

const UNION_RESPONSE_CODES = {
  SUCCESS: "0",
  UNAUTHORIZED_CALLER: "-1",
  // Response codes when the value specified is invalid:
  // 1. The requested amount of RBTC, combined with previously requested amounts, exceeds the current locking cap value.
  // 2. The released amount exceeds the total amount of RBTC previously transferred.
  // 3. The new cap value is less than the current cap or excessive.
  INVALID_VALUE: "-2",
  REQUEST_DISABLED: "-3",
  RELEASE_DISABLED: "-3",
  GENERIC_ERROR: "-10"
};


module.exports = {
  INITIAL_UNION_BRIDGE_ADDRESS,
  INITIAL_UNION_LOCKING_CAP,
  UNION_LOCKING_CAP_INCREMENTS_MULTIPLIER,
  CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
  UNION_BRIDGE_AUTHORIZER_1_PK,
  UNION_BRIDGE_AUTHORIZER_2_PK,
  UNION_BRIDGE_AUTHORIZER_3_PK,
  UNION_BRIDGE_AUTHORIZER_DEPLOYER_PK,
  UNION_BRIDGE_EVENTS,
  UNION_BRIDGE_STORAGE_INDICES,
  UNION_RESPONSE_CODES
};
