const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const BN = require('bn.js');

const {
    UNION_RESPONSE_CODES,
    UNION_BRIDGE_STORAGE_INDICES,
} = require('./constants/union-bridge-constants');
const { BRIDGE_ADDRESS } = require('./constants/bridge-constants');
const { getBridgeStorageValueDecodedHexString } = require('./utils');
const { getStorageBytesAt } = require('./rsk-rpc-utils');

/**
 * Finds and decodes the first log in `txReceipt` matching `eventName` in `contract`'s ABI.
 * @param {import('ethers').Contract} contract the contract whose interface decodes the event
 * @param {import('ethers').TransactionReceipt} txReceipt
 * @param {string} eventName
 * @returns {import('ethers').LogDescription | undefined}
 */
const findEventInReceipt = (contract, txReceipt, eventName) => {
    for (const log of txReceipt.logs) {
        const parsedLog = contract.interface.parseLog(log);
        if (parsedLog && parsedLog.name === eventName) {
            return parsedLog;
        }
    }
    return undefined;
};

const NO_VALUE = '0x0';

const PERMISSION_ENABLED = '01';

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

const assertUnionAuthorizerInitializedEventWasEmitted = (
    contract,
    txReceipt,
    votingPeriodInBlocks
) => {
    const expectedEventName = 'Initialized';
    const foundEvent = findEventInReceipt(contract, txReceipt, expectedEventName);
    expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be
        .undefined;
    expect(foundEvent.args.votingPeriodInBlocks.toString()).to.equal(
        votingPeriodInBlocks.toString()
    );
};

const assertIncreaseUnionLockingCapVotedEventWasEmitted = (
    contract,
    txReceipt,
    newLockingCap,
    authorizedMember
) => {
    const IncreaseUnionLockingCapVotedEvent = 'IncreaseUnionLockingCapVoted';
    const foundIncreaseLockingCapEvent = findEventInReceipt(
        contract,
        txReceipt,
        IncreaseUnionLockingCapVotedEvent
    );
    expect(
        foundIncreaseLockingCapEvent,
        `Expected to find event with name "${IncreaseUnionLockingCapVotedEvent}"`
    ).to.not.be.undefined;
    expect(foundIncreaseLockingCapEvent.args.newLockingCap.toString()).to.equal(
        newLockingCap.toString()
    );
    expect(foundIncreaseLockingCapEvent.args.voter.toLowerCase()).to.equal(
        authorizedMember.toLowerCase()
    );
};

const assertIncreaseUnionLockingCapExecutedEventWasEmitted = (
    contract,
    txReceipt,
    newLockingCap
) => {
    const executedEventName = 'IncreaseUnionLockingCapExecuted';
    const foundExecutedEvent = findEventInReceipt(contract, txReceipt, executedEventName);
    expect(foundExecutedEvent, `Expected to find event with name "${executedEventName}"`).to.not.be
        .undefined;
    expect(foundExecutedEvent.args.newLockingCap.toString()).to.equal(newLockingCap.toString());
};

const assertUnionTransferPermissionsVotedEventWasEmitted = (
    contract,
    txReceipt,
    requestEnabled,
    releaseEnabled,
    authorizedMember
) => {
    const votedEventName = 'SetUnionBridgeTransferPermissionsVoted';
    const foundVotedEvent = findEventInReceipt(contract, txReceipt, votedEventName);
    expect(foundVotedEvent, `Expected to find event with name "${votedEventName}"`).to.not.be
        .undefined;
    expect(foundVotedEvent.args.requestEnabled).to.equal(requestEnabled);
    expect(foundVotedEvent.args.releaseEnabled).to.equal(releaseEnabled);
    expect(foundVotedEvent.args.voter.toLowerCase()).to.equal(authorizedMember.toLowerCase());
};

const assertUnionTransferPermissionsExecutedEventWasEmitted = (
    contract,
    txReceipt,
    requestEnabled,
    releaseEnabled
) => {
    const executedEventName = 'SetUnionBridgeTransferPermissionsExecuted';
    const foundExecutedEvent = findEventInReceipt(contract, txReceipt, executedEventName);
    expect(foundExecutedEvent, `Expected to find event with name "${executedEventName}"`).to.not.be
        .undefined;
    expect(foundExecutedEvent.args.requestEnabled).to.equal(requestEnabled);
    expect(foundExecutedEvent.args.releaseEnabled).to.equal(releaseEnabled);
};

const assertBridgeCallFailedEventWasEmitted = (contract, txReceipt, unionResponseCode) => {
    const executedEventName = 'BridgeCallFailed';
    const foundExecutedEvent = findEventInReceipt(contract, txReceipt, executedEventName);
    expect(foundExecutedEvent, `Expected to find event with name "${executedEventName}"`).to.not.be
        .undefined;
    expect(foundExecutedEvent.args.unionResponseCode.toString()).to.equal(unionResponseCode);
};

const assertNoUnionAddressIsStored = async (rskClient) => {
    const unionBridgeAddressEncoded = await getStorageBytesAt(
        rskClient,
        BRIDGE_ADDRESS,
        UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_CONTRACT_ADDRESS
    );
    expect(unionBridgeAddressEncoded).to.equal(NO_VALUE);
};

const assertStoredUnionLockingCap = async (rskClient, expectedLockingCap) => {
    const unionLockingCapEncoded = await getStorageBytesAt(
        rskClient,
        BRIDGE_ADDRESS,
        UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_LOCKING_CAP
    );
    expect(unionLockingCapEncoded).to.not.equal(NO_VALUE);
    const unionLockingCapDecoded = getBridgeStorageValueDecodedHexString(
        unionLockingCapEncoded,
        false
    );
    const actualUnionLockingCap = new BN(unionLockingCapDecoded, 16);
    expect(actualUnionLockingCap.toString()).to.equal(expectedLockingCap.toString());
};

const assertNoWeisTransferredToUnionBridgeIsStored = async (rskClient) => {
    const weisTransferredEncoded = await getStorageBytesAt(
        rskClient,
        BRIDGE_ADDRESS,
        UNION_BRIDGE_STORAGE_INDICES.WEIS_TRANSFERRED_TO_UNION_BRIDGE
    );
    expect(weisTransferredEncoded).to.equal(NO_VALUE);
};

const assertUnionTransferredPermissions = async (
    rskClient,
    expectedRequestPermission,
    expectedReleasePermission
) => {
    const actualRequestPermissionEncoded = await getStorageBytesAt(
        rskClient,
        BRIDGE_ADDRESS,
        UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_REQUEST_ENABLED
    );
    const actualReleasePermissionEncoded = await getStorageBytesAt(
        rskClient,
        BRIDGE_ADDRESS,
        UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_RELEASE_ENABLED
    );
    expect(actualRequestPermissionEncoded).to.not.equal(NO_VALUE);
    expect(actualReleasePermissionEncoded).to.not.equal(NO_VALUE);
    const actualRequestPermission =
        getBridgeStorageValueDecodedHexString(actualRequestPermissionEncoded, false) ===
        PERMISSION_ENABLED;
    const actualReleasePermission =
        getBridgeStorageValueDecodedHexString(actualReleasePermissionEncoded, false) ===
        PERMISSION_ENABLED;
    expect(actualRequestPermission).to.equal(expectedRequestPermission);
    expect(actualReleasePermission).to.equal(expectedReleasePermission);
};

const assertNoUnionTransferredPermissionsIsStored = async (rskClient) => {
    const actualRequestPermissionEncoded = await getStorageBytesAt(
        rskClient,
        BRIDGE_ADDRESS,
        UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_REQUEST_ENABLED
    );
    const actualReleasePermissionEncoded = await getStorageBytesAt(
        rskClient,
        BRIDGE_ADDRESS,
        UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_RELEASE_ENABLED
    );
    expect(actualRequestPermissionEncoded).to.equal(NO_VALUE);
    expect(actualReleasePermissionEncoded).to.equal(NO_VALUE);
};

const getWeisTransferredToUnionBridge = async (rskClient) => {
    const weisTransferredEncoded = await getStorageBytesAt(
        rskClient,
        BRIDGE_ADDRESS,
        UNION_BRIDGE_STORAGE_INDICES.WEIS_TRANSFERRED_TO_UNION_BRIDGE
    );
    if (weisTransferredEncoded === NO_VALUE) {
        return '0';
    }
    const weisTransferredDecoded = getBridgeStorageValueDecodedHexString(
        weisTransferredEncoded,
        false
    );
    return new BN(weisTransferredDecoded, 16).toString();
};

const assertWeisTransferredToUnionBridge = async (rskClient, expectedWeisTransferred) => {
    const actualWeisTransferred = await getWeisTransferredToUnionBridge(rskClient);
    expect(actualWeisTransferred).to.equal(expectedWeisTransferred.toString());
};

const getUnionBridgeContractAddress = async (bridge) => {
    return await bridge.getUnionBridgeContractAddress();
};

const getUnionBridgeLockingCap = async (bridge) => {
    return await bridge.getUnionBridgeLockingCap();
};

const assertLockingCap = async (rskClient, bridge, expectedLockingCap) => {
    const actualLockingCap = await getUnionBridgeLockingCap(bridge);
    expect(actualLockingCap.toString()).to.equal(expectedLockingCap.toString());
    await assertStoredUnionLockingCap(rskClient, expectedLockingCap);
};

const assertUnionBridgeBalance = async (rskTxHelper, bridge, expectedBalance) => {
    const actualBalance = await getUnionBridgeBalance(rskTxHelper, bridge);
    expect(actualBalance.toString()).to.equal(expectedBalance.toString());
};

const getUnionBridgeBalance = async (rskTxHelper, bridge) => {
    const unionBridgeContractAddress = await getUnionBridgeContractAddress(bridge);
    const unionBridgeContractBalance = await rskTxHelper.getBalance(unionBridgeContractAddress);
    return unionBridgeContractBalance.toString();
};

module.exports = {
    assertSuccessfulResponseCode,
    assertUnauthorizedResponseCode,
    assertRequestDisabledResponseCode,
    assertReleaseDisabledResponseCode,
    assertInvalidValueResponseCode,
    assertUnionAuthorizerInitializedEventWasEmitted,
    assertIncreaseUnionLockingCapVotedEventWasEmitted,
    assertIncreaseUnionLockingCapExecutedEventWasEmitted,
    assertUnionTransferPermissionsVotedEventWasEmitted,
    assertUnionTransferPermissionsExecutedEventWasEmitted,
    assertBridgeCallFailedEventWasEmitted,
    assertNoUnionAddressIsStored,
    assertStoredUnionLockingCap,
    assertNoWeisTransferredToUnionBridgeIsStored,
    assertUnionTransferredPermissions,
    assertNoUnionTransferredPermissionsIsStored,
    assertLockingCap,
    assertUnionBridgeBalance,
    assertWeisTransferredToUnionBridge,
    getUnionBridgeContractAddress,
    getUnionBridgeLockingCap,
    getUnionBridgeBalance,
    getWeisTransferredToUnionBridge,
};
