const chai = require("chai");
const expect = chai.expect;
chai.use(require("chai-as-promised"));
const BN = require("bn.js");

const { UNION_RESPONSE_CODES, UNION_BRIDGE_STORAGE_INDICES } = require("./constants/union-bridge-constants");
const { BRIDGE_ADDRESS } = require("./constants/bridge-constants");
const { getBridgeStorageValueDecodedHexString } = require("./utils");

const NO_VALUE = "0x0";

const PERMISSION_ENABLED = "01";

const assertSuccessfulResponseCode = (actualUnionResponseCode) => {
  expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
};

const assertUnauthorizedResponseCode = (actualUnionResponseCode) => {
  expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.UNAUTHORIZED_CALLER);
};

const assertRequestDisabledResponseCode = (actualUnionResponseCode) => {
  expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.REQUEST_DISABLED);
};

const assertReleaseDisabledResponseCode = (actualUnionResponseCode) => {
  expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.RELEASE_DISABLED);
};

const assertInvalidValueResponseCode = (actualUnionResponseCode) => {
  expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.INVALID_VALUE);
};

const assertNoEventWasEmitted = async (txReceipt) => {
  const isEmpty = Object.keys(txReceipt.events).length === 0;
  expect(isEmpty, "No event should have been emitted").to.be.true;
};

const assertContractCallFails = async (methodCall, options) => {
  await expect(methodCall.call(options)).to.be.rejected;
};

const assertUnionAuthorizerInitializedEventWasEmitted = (txReceipt, votingPeriodInBlocks) => {
  const expectedEventName = "Initialized";
  const foundEvent = txReceipt.events[expectedEventName];
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be.undefined;
  expect(foundEvent.returnValues.votingPeriodInBlocks).to.equal(votingPeriodInBlocks.toString());
};

const assertIncreaseUnionLockingCapVotedEventWasEmitted = (newLockingCap, authorizedMember, txReceipt) => {
  const IncreaseUnionLockingCapVotedEvent = "IncreaseUnionLockingCapVoted";
  const foundIncreaseLockingCapEvent = txReceipt.events[IncreaseUnionLockingCapVotedEvent];
  expect(foundIncreaseLockingCapEvent, `Expected to find event with name "${IncreaseUnionLockingCapVotedEvent}"`).to.not
    .be.undefined;
  expect(foundIncreaseLockingCapEvent.returnValues.newLockingCap).to.equal(newLockingCap.toString());
  expect(foundIncreaseLockingCapEvent.returnValues.voter.toLowerCase()).to.equal(authorizedMember.toLowerCase());
};

const assertIncreaseUnionLockingCapExecutedEventWasEmitted = (newLockingCap, txReceipt) => {
  const executedEventName = "IncreaseUnionLockingCapExecuted";
  const foundExecutedEvent = txReceipt.events[executedEventName];
  expect(foundExecutedEvent, `Expected to find event with name "${executedEventName}"`).to.not.be.undefined;
  expect(foundExecutedEvent.returnValues.newLockingCap).to.equal(newLockingCap.toString());
};

const assertUnionTransferPermissionsVotedEventWasEmitted = (
  requestEnabled,
  releaseEnabled,
  authorizedMember,
  txReceipt
) => {
  const votedEventName = "SetUnionBridgeTransferPermissionsVoted";
  const foundVotedEvent = txReceipt.events[votedEventName];
  expect(foundVotedEvent, `Expected to find event with name "${votedEventName}"`).to.not.be.undefined;
  expect(foundVotedEvent.returnValues.requestEnabled).to.equal(requestEnabled);
  expect(foundVotedEvent.returnValues.releaseEnabled).to.equal(releaseEnabled);
  expect(foundVotedEvent.returnValues.voter.toLowerCase()).to.equal(authorizedMember.toLowerCase());
};

const assertUnionTransferPermissionsExecutedEventWasEmitted = (requestEnabled, releaseEnabled, txReceipt) => {
  const executedEventName = "SetUnionBridgeTransferPermissionsExecuted";
  const foundExecutedEvent = txReceipt.events[executedEventName];
  expect(foundExecutedEvent, `Expected to find event with name "${executedEventName}"`).to.not.be.undefined;
  expect(foundExecutedEvent.returnValues.requestEnabled).to.equal(requestEnabled);
  expect(foundExecutedEvent.returnValues.releaseEnabled).to.equal(releaseEnabled);
};

const assertNoUnionAddressIsStored = async (rskClient) => {
  const unionBridgeAddressEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_CONTRACT_ADDRESS
  );
  expect(unionBridgeAddressEncoded).to.equal(NO_VALUE);
};

const assertStoredUnionLockingCap = async (rskClient, expectedLockingCap) => {
  const unionLockingCapEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_LOCKING_CAP
  );
  expect(unionLockingCapEncoded).to.not.equal(NO_VALUE);
  const unionLockingCapDecoded = getBridgeStorageValueDecodedHexString(unionLockingCapEncoded, false);
  const actualUnionLockingCap = new BN(unionLockingCapDecoded, 16);
  expect(actualUnionLockingCap.toString()).to.equal(expectedLockingCap.toString());
};

const assertNoWeisTransferredToUnionBridgeIsStored = async (rskClient) => {
  const weisTransferredEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.WEIS_TRANSFERRED_TO_UNION_BRIDGE
  );
  expect(weisTransferredEncoded).to.equal(NO_VALUE);
};

const assertUnionTransferredPermissions = async (rskClient, expectedRequestPermission, expectedReleasePermission) => {
  const actualRequestPermissionEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_REQUEST_ENABLED
  );
  const actualReleasePermissionEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_RELEASE_ENABLED
  );
  expect(actualRequestPermissionEncoded).to.not.equal(NO_VALUE);
  expect(actualReleasePermissionEncoded).to.not.equal(NO_VALUE);
  const actualRequestPermission =
    getBridgeStorageValueDecodedHexString(actualRequestPermissionEncoded, false) === PERMISSION_ENABLED;
  const actualReleasePermission =
    getBridgeStorageValueDecodedHexString(actualReleasePermissionEncoded, false) === PERMISSION_ENABLED;
  expect(actualRequestPermission).to.equal(expectedRequestPermission);
  expect(actualReleasePermission).to.equal(expectedReleasePermission);
};

const assertNoUnionTransferredPermissionsIsStored = async (rskClient) => {
  const actualRequestPermissionEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_REQUEST_ENABLED
  );
  const actualReleasePermissionEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_RELEASE_ENABLED
  );
  expect(actualRequestPermissionEncoded).to.equal(NO_VALUE);
  expect(actualReleasePermissionEncoded).to.equal(NO_VALUE);
};

const getWeisTransferredToUnionBridge = async (rskClient) => {
  const weisTransferredEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.WEIS_TRANSFERRED_TO_UNION_BRIDGE
  );
  if (weisTransferredEncoded === NO_VALUE) {
    return "0";
  }
  const weisTransferredDecoded = getBridgeStorageValueDecodedHexString(weisTransferredEncoded, false);
  return new BN(weisTransferredDecoded, 16).toString();
};

const assertWeisTransferredToUnionBridge = async (rskClient, expectedWeisTransferred) => {
  const actualWeisTransferred = await getWeisTransferredToUnionBridge(rskClient);
  expect(actualWeisTransferred).to.equal(expectedWeisTransferred.toString());
};

const getUnionBridgeContractAddress = async (bridgeMethods) => {
  return await bridgeMethods.getUnionBridgeContractAddress().call();
};

const getUnionBridgeLockingCap = async (bridgeMethods) => {
  return await bridgeMethods.getUnionBridgeLockingCap().call();
};

const assertLockingCap = async (rskClient, bridgeMethods, expectedLockingCap) => {
  const actualLockingCap = await getUnionBridgeLockingCap(bridgeMethods);
  expect(actualLockingCap).to.equal(expectedLockingCap);
  await assertStoredUnionLockingCap(rskClient, expectedLockingCap);
};

const assertUnionBridgeBalance = async (rskTxHelper, bridgeMethods, expectedBalance) => {
  const actualBalance = await getUnionBridgeBalance(rskTxHelper, bridgeMethods);
  expect(actualBalance.toString()).to.equal(expectedBalance.toString());
};

const getUnionBridgeBalance = async (rskTxHelper, bridgeMethods) => {
  const unionBridgeContractAddress = await getUnionBridgeContractAddress(bridgeMethods);
  const unionBridgeContractBalance = await rskTxHelper.getBalance(unionBridgeContractAddress);
  return unionBridgeContractBalance.toString();
};

module.exports = {
  assertSuccessfulResponseCode,
  assertUnauthorizedResponseCode,
  assertRequestDisabledResponseCode,
  assertReleaseDisabledResponseCode,
  assertInvalidValueResponseCode,
  assertNoEventWasEmitted,
  assertContractCallFails,
  assertUnionAuthorizerInitializedEventWasEmitted,
  assertIncreaseUnionLockingCapVotedEventWasEmitted,
  assertIncreaseUnionLockingCapExecutedEventWasEmitted,
  assertUnionTransferPermissionsVotedEventWasEmitted,
  assertUnionTransferPermissionsExecutedEventWasEmitted,
  assertNoUnionAddressIsStored,
  assertStoredUnionLockingCap,
  assertNoWeisTransferredToUnionBridgeIsStored,
  assertUnionTransferredPermissions,
  assertNoUnionTransferredPermissionsIsStored,
  getWeisTransferredToUnionBridge,
  assertWeisTransferredToUnionBridge,
  getUnionBridgeContractAddress,
  getUnionBridgeLockingCap,
  assertLockingCap,
  assertUnionBridgeBalance,
  getUnionBridgeBalance,
};
