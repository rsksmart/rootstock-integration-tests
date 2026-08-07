const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const BN = require('bn.js');

const rskUtils = require('../rsk-utils');

const { getBridge } = require('../bridge-provider');
const { getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const precompiledAbis = require('@rsksmart/rsk-precompiled-abis');

const { btcToWeis, ethToWeis, weisToEth } = require('@rsksmart/btc-eth-unit-converter');

const {
    CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
    UNION_BRIDGE_AUTHORIZER_1_PK,
    UNION_BRIDGE_AUTHORIZER_2_PK,
    UNION_BRIDGE_AUTHORIZER_3_PK,
    UNION_BRIDGE_AUTHORIZER_DEPLOYER_PK,
    INITIAL_UNION_BRIDGE_ADDRESS,
    INITIAL_UNION_LOCKING_CAP,
    UNION_LOCKING_CAP_INCREMENTS_MULTIPLIER,
    UNION_BRIDGE_EVENTS,
    UNION_RESPONSE_CODES,
} = require('../constants/union-bridge-constants');

const {
    deployUnionBridgeContract,
    deployUnionBridgeAuthorizerContract,
} = require('../contractDeployer');
const { BRIDGE_ADDRESS } = require('../constants/bridge-constants');

const {
    assertSuccessfulResponseCode,
    assertUnauthorizedResponseCode,
    assertRequestDisabledResponseCode,
    assertReleaseDisabledResponseCode,
    assertInvalidValueResponseCode,
    assertUnionAuthorizerInitializedEventWasEmitted,
    assertNoUnionAddressIsStored,
    assertNoWeisTransferredToUnionBridgeIsStored,
    assertUnionTransferredPermissions,
    assertNoUnionTransferredPermissionsIsStored,
    getWeisTransferredToUnionBridge,
    getUnionBridgeContractAddress,
    getUnionBridgeLockingCap,
    assertLockingCap,
    assertUnionBridgeBalance,
    getUnionBridgeBalance,
    assertIncreaseUnionLockingCapVotedEventWasEmitted,
    assertIncreaseUnionLockingCapExecutedEventWasEmitted,
    assertUnionTransferPermissionsVotedEventWasEmitted,
    assertUnionTransferPermissionsExecutedEventWasEmitted,
    assertBridgeCallFailedEventWasEmitted,
    assertWeisTransferredToUnionBridge,
} = require('../union-bridge-utils');

const UNION_AUTHORIZER_VOTING_PERIOD_IN_BLOCKS = 360;

const UNAUTHORIZED_1_PRIVATE_KEY =
    'bb7a53f495b863a007a3b1e28d2da2a5ec0343976a9be64e6fcfb97791b0112b';

const INITIAL_MAX_LOCKING_CAP_INCREMENT = ethToWeis(
    Number(weisToEth(INITIAL_UNION_LOCKING_CAP)) * UNION_LOCKING_CAP_INCREMENTS_MULTIPLIER
);
const NEW_LOCKING_CAP_1 = (INITIAL_MAX_LOCKING_CAP_INCREMENT - ethToWeis(0.2)).toString();
const NEW_LOCKING_CAP_2 = (INITIAL_MAX_LOCKING_CAP_INCREMENT - ethToWeis(0.1)).toString();

const AMOUNT_TO_REQUEST = btcToWeis(0.002);
const AMOUNT_TO_RELEASE = btcToWeis(0.001);

const REQUEST_PERMISSION_ENABLED = true;
const REQUEST_PERMISSION_DISABLED = false;
const RELEASE_PERMISSION_ENABLED = true;
const RELEASE_PERMISSION_DISABLED = false;

let rskTxHelpers;
let rskTxHelper;
let rskClient;
let bridge;

/**
 * Calls `contract[methodName](...args)` as a static (read) call, treating an ethers `BAD_DATA`
 * decode failure (the node returning empty `0x` for an unset `bytes` value) as `null`, matching
 * the previous web3 behavior for these same calls.
 */
const callOrNullIfEmpty = async (contract, methodName, ...args) => {
    try {
        return await contract[methodName](...args);
    } catch (error) {
        if (error.code === 'BAD_DATA' && error.value === '0x') {
            return null;
        }
        throw error;
    }
};

let changeUnionAddressAuthorizerAddress;

let unionBridgeAuthorizerMember1Address;
let unionBridgeAuthorizerMember2Address;
let unionBridgeAuthorizerMember3Address;

let unionBridgeAuthorizerOwnerAddress;
let unionBridgeAuthorizerContract;
let unionBridgeAuthorizerContractAddress;

let unauthorizedAddress;

let unionBridgeContractOwnerAddress;
let unionBridgeContract;
let unionBridgeContractAddress;

let bridgeContractAbi;

const execute = (description) => {
    describe(description, () => {
        before(async () => {
            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            rskClient = rskTxHelper.getClient();
            bridge = await getBridge(rskClient);

            await createAndFundAccounts();
            await deployAndFundUnionBridgeContract();
            await deployAndInitUnionAuthorizerContract();

            bridgeContractAbi = precompiledAbis.bridge.abi;
        });

        it('should setUnionBridgeContractAddressForTestnet change union address', async () => {
            // Arrange
            const unionBridgeAddressBeforeUpdate = await getUnionBridgeContractAddress(bridge);
            expect(unionBridgeAddressBeforeUpdate).to.equal(INITIAL_UNION_BRIDGE_ADDRESS);
            await assertNoUnionAddressIsStored(rskClient);

            // Act
            const txReceipt = await setUnionBridgeContractAddressForTestnet(
                unionBridgeContractAddress,
                changeUnionAddressAuthorizerAddress,
                assertSuccessfulResponseCode
            );

            // Assert
            const currentUnionBridgeContractAddress = await getUnionBridgeContractAddress(bridge);
            expect(currentUnionBridgeContractAddress).to.equal(unionBridgeContractAddress);
            expect(unionBridgeAddressBeforeUpdate).to.not.equal(unionBridgeContractAddress);
            await rskUtils.assertNoEventWasEmitted(txReceipt);
        });

        describe('Super and base events', () => {
            const MAX_EVENT_DATA_LENGTH = 128;

            const sampleSuperHex = () =>
                `0x${Buffer.from('rit-super-event-payload', 'utf8').toString('hex')}`;

            const sampleBaseHex = () =>
                `0x${Buffer.from('rit-base-event-payload', 'utf8').toString('hex')}`;

            const maxLengthPayloadHex = () => `0x${'ab'.repeat(MAX_EVENT_DATA_LENGTH)}`;

            const tooLongPayloadHex = () => `0x${'cd'.repeat(MAX_EVENT_DATA_LENGTH + 1)}`;

            beforeEach(async () => {
                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'clearSuperEvent',
                    [],
                    unionBridgeContractOwnerAddress
                );

                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'clearBaseEvent',
                    [],
                    unionBridgeContractOwnerAddress
                );
            });

            it('should return empty super and base event bytes after clearing', async () => {
                const superEvent = await callOrNullIfEmpty(bridge, 'getSuperEvent');
                const baseEvent = await callOrNullIfEmpty(bridge, 'getBaseEvent');
                expect(superEvent).to.be.null;
                expect(baseEvent).to.be.null;
            });

            it('should persist super event data when set by the union bridge contract', async () => {
                const payload = sampleSuperHex();

                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'setSuperEvent',
                    [payload],
                    unionBridgeContractOwnerAddress
                );

                const stored = await callOrNullIfEmpty(bridge, 'getSuperEvent');
                expect(stored.toLowerCase()).to.equal(payload.toLowerCase());
                const baseUntouched = await callOrNullIfEmpty(bridge, 'getBaseEvent');
                expect(baseUntouched).to.be.null;
            });

            it('should clear super event when clearSuperEvent is called from the union bridge contract', async () => {
                const payload = sampleSuperHex();
                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'setSuperEvent',
                    [payload],
                    unionBridgeContractOwnerAddress
                );
                expect((await callOrNullIfEmpty(bridge, 'getSuperEvent')).toLowerCase()).to.equal(
                    payload.toLowerCase()
                );

                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'clearSuperEvent',
                    [],
                    unionBridgeContractOwnerAddress
                );
                expect(await callOrNullIfEmpty(bridge, 'getSuperEvent')).to.be.null;
            });

            it('should persist base event data when set by the union bridge contract', async () => {
                const payload = sampleBaseHex();

                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'setBaseEvent',
                    [payload],
                    unionBridgeContractOwnerAddress
                );

                const stored = await callOrNullIfEmpty(bridge, 'getBaseEvent');
                expect(stored.toLowerCase()).to.equal(payload.toLowerCase());
                const superUntouched = await callOrNullIfEmpty(bridge, 'getSuperEvent');
                expect(superUntouched).to.be.null;
            });

            it('should clear base event when clearBaseEvent is called from the union bridge contract', async () => {
                const payload = sampleBaseHex();
                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'setBaseEvent',
                    [payload],
                    unionBridgeContractOwnerAddress
                );
                expect((await callOrNullIfEmpty(bridge, 'getBaseEvent')).toLowerCase()).to.equal(
                    payload.toLowerCase()
                );

                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'clearBaseEvent',
                    [],
                    unionBridgeContractOwnerAddress
                );
                expect(await callOrNullIfEmpty(bridge, 'getBaseEvent')).to.be.null;
            });

            it('should reject setSuperEvent from a direct bridge call when the caller is not the union bridge', async () => {
                const payload = sampleSuperHex();
                expect(await callOrNullIfEmpty(bridge, 'getSuperEvent')).to.be.null;
                expect(await callOrNullIfEmpty(bridge, 'getBaseEvent')).to.be.null;

                await bridge.setSuperEvent.staticCall(payload, { from: unauthorizedAddress });

                expect(await callOrNullIfEmpty(bridge, 'getSuperEvent')).to.be.null;
                expect(await callOrNullIfEmpty(bridge, 'getBaseEvent')).to.be.null;
            });

            it('should reject setBaseEvent from a direct bridge call when the caller is not the union bridge', async () => {
                const payload = sampleBaseHex();
                expect(await callOrNullIfEmpty(bridge, 'getSuperEvent')).to.be.null;
                expect(await callOrNullIfEmpty(bridge, 'getBaseEvent')).to.be.null;

                await bridge.setBaseEvent.staticCall(payload, { from: unauthorizedAddress });

                expect(await callOrNullIfEmpty(bridge, 'getSuperEvent')).to.be.null;
                expect(await callOrNullIfEmpty(bridge, 'getBaseEvent')).to.be.null;
            });

            it('should reject clearSuperEvent from a direct bridge call when the caller is not the union bridge', async () => {
                const payload = sampleSuperHex();
                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'setSuperEvent',
                    [payload],
                    unionBridgeContractOwnerAddress
                );
                expect((await callOrNullIfEmpty(bridge, 'getSuperEvent')).toLowerCase()).to.equal(
                    payload.toLowerCase()
                );

                await bridge.clearSuperEvent.staticCall({ from: unauthorizedAddress });

                expect((await callOrNullIfEmpty(bridge, 'getSuperEvent')).toLowerCase()).to.equal(
                    payload.toLowerCase()
                );
            });

            it('should reject clearBaseEvent from a direct bridge call when the caller is not the union bridge', async () => {
                const payload = sampleBaseHex();
                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'setBaseEvent',
                    [payload],
                    unionBridgeContractOwnerAddress
                );
                expect((await callOrNullIfEmpty(bridge, 'getBaseEvent')).toLowerCase()).to.equal(
                    payload.toLowerCase()
                );

                await bridge.clearBaseEvent.staticCall({ from: unauthorizedAddress });

                expect((await callOrNullIfEmpty(bridge, 'getBaseEvent')).toLowerCase()).to.equal(
                    payload.toLowerCase()
                );
            });

            it('should reject setSuperEvent when payload length is above the maximum', async () => {
                await rskUtils.assertContractCallFails(
                    unionBridgeContract,
                    'setSuperEvent',
                    [tooLongPayloadHex()],
                    { from: unionBridgeContractOwnerAddress }
                );
            });

            it('should reject setBaseEvent when payload length is above the maximum', async () => {
                await rskUtils.assertContractCallFails(
                    unionBridgeContract,
                    'setBaseEvent',
                    [tooLongPayloadHex()],
                    { from: unionBridgeContractOwnerAddress }
                );
            });

            it('should accept setSuperEvent at exactly the maximum payload length', async () => {
                const payload = maxLengthPayloadHex();
                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'setSuperEvent',
                    [payload],
                    unionBridgeContractOwnerAddress
                );
                const stored = await callOrNullIfEmpty(bridge, 'getSuperEvent');
                expect(stored.toLowerCase()).to.equal(payload.toLowerCase());
            });

            it('should accept setBaseEvent at exactly the maximum payload length', async () => {
                const payload = maxLengthPayloadHex();
                await rskUtils.sendTransaction(
                    rskTxHelper,
                    unionBridgeContract,
                    'setBaseEvent',
                    [payload],
                    unionBridgeContractOwnerAddress
                );
                const stored = await callOrNullIfEmpty(bridge, 'getBaseEvent');
                expect(stored.toLowerCase()).to.equal(payload.toLowerCase());
            });
        });

        it('should increaseUnionBridgeLockingCap return UNAUTHORIZED_CALLER when caller is unauthorized', async () => {
            // Arrange
            const unionLockingCapBeforeUpdate = await getUnionBridgeLockingCap(bridge);
            expect(unionLockingCapBeforeUpdate.toString()).to.equal(
                INITIAL_UNION_LOCKING_CAP.toString()
            );

            // Act & Assert
            await rskUtils.assertContractCallFails(
                bridge,
                'increaseUnionBridgeLockingCap',
                [NEW_LOCKING_CAP_1],
                { from: unauthorizedAddress }
            );
        });

        it('should increaseUnionBridgeLockingCap be successful when caller is authorized', async () => {
            // Act
            const txReceipt = await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_1);

            // Assert
            assertIncreaseUnionLockingCapExecutedEventWasEmitted(
                unionBridgeAuthorizerContract,
                txReceipt,
                NEW_LOCKING_CAP_1
            );
            await assertLockingCap(rskClient, bridge, NEW_LOCKING_CAP_1);
            await assertLogUnionLockingCapIncreased(
                txReceipt.transactionHash,
                INITIAL_UNION_LOCKING_CAP,
                NEW_LOCKING_CAP_1
            );
        });

        it('should increaseUnionBridgeLockingCap be successful when vote again for another value', async () => {
            // Arrange
            const lockingCapBeforeUpdate = await getUnionBridgeLockingCap(bridge);
            await assertLockingCap(rskClient, bridge, lockingCapBeforeUpdate);

            // Act
            const txReceipt = await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_2);

            // Assert
            assertIncreaseUnionLockingCapExecutedEventWasEmitted(
                unionBridgeAuthorizerContract,
                txReceipt,
                NEW_LOCKING_CAP_2
            );
            await assertLockingCap(rskClient, bridge, NEW_LOCKING_CAP_2);
            await assertLogUnionLockingCapIncreased(
                txReceipt.transactionHash,
                NEW_LOCKING_CAP_1,
                NEW_LOCKING_CAP_2
            );
        });

        it('should increaseUnionBridgeLockingCap fail when trying to decrease the locking cap', async () => {
            // Arrange
            const lockingCapBeforeUpdate = await getUnionBridgeLockingCap(bridge);
            const smallerLockingCap = new BN(lockingCapBeforeUpdate.toString()).sub(new BN(1));

            // Act
            const txReceipt = await increaseUnionBridgeLockingCap(smallerLockingCap.toString());

            // Assert
            assertBridgeCallFailedEventWasEmitted(
                unionBridgeAuthorizerContract,
                txReceipt,
                UNION_RESPONSE_CODES.INVALID_VALUE
            );
            await assertLockingCap(rskClient, bridge, lockingCapBeforeUpdate);
        });

        it('should requestUnionBridgeRbtc return UNAUTHORIZED_CALLER when caller is unauthorized', async () => {
            // Arrange
            await assertNoWeisTransferredToUnionBridgeIsStored(rskClient);
            const unionBridgeBalanceBefore = await getUnionBridgeBalance(rskTxHelper, bridge);

            // Act
            const txReceipt = await requestUnionBridgeRbtcFromUnauthorizedCaller(
                AMOUNT_TO_REQUEST,
                assertUnauthorizedResponseCode
            );

            // Assert
            await assertNoWeisTransferredToUnionBridgeIsStored(rskClient);
            await assertUnionBridgeBalance(rskTxHelper, bridge, unionBridgeBalanceBefore);
            await rskUtils.assertNoEventWasEmitted(txReceipt);
        });

        it('should requestUnionBridgeRbtc be successful when caller is the union contract address', async () => {
            // Arrange
            const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await requestUnionBridgeRbtc(
                AMOUNT_TO_REQUEST,
                assertSuccessfulResponseCode
            );

            // Assert
            await assertLogUnionRbtcRequested(txReceipt.transactionHash, AMOUNT_TO_REQUEST);
            const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(
                new BN(AMOUNT_TO_REQUEST)
            );
            const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(
                new BN(AMOUNT_TO_REQUEST)
            );
            await assertWeisTransferredAndUnionBridgeContractBalance(
                expectedWeisTransferred,
                expectedUnionBridgeBalance
            );
        });

        it('should releaseUnionBridgeRbtc return UNAUTHORIZED_CALLER when caller is unauthorized', async () => {
            // Arrange
            const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await releaseUnionBridgeRbtcFromUnauthorizedCaller(
                AMOUNT_TO_RELEASE,
                assertUnauthorizedResponseCode
            );

            // Assert
            await assertWeisTransferredAndUnionBridgeContractBalance(
                weisTransferredBeforeRelease,
                unionBridgeBalanceBeforeRelease
            );
            await rskUtils.assertNoEventWasEmitted(txReceipt);
        });

        it('should releaseUnionBridgeRbtc be successful when caller is the union contract address', async () => {
            // Arrange
            const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await releaseUnionBridgeRbtc(
                AMOUNT_TO_RELEASE,
                assertSuccessfulResponseCode
            );

            // Assert
            await assertLogUnionRbtcReleased(txReceipt.transactionHash, AMOUNT_TO_RELEASE);
            const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(
                new BN(AMOUNT_TO_RELEASE)
            );
            const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(
                new BN(AMOUNT_TO_RELEASE)
            );
            await assertWeisTransferredAndUnionBridgeContractBalance(
                expectedWeisTransferredAfter,
                expectedUnionBridgeBalanceAfter
            );
        });

        it('should setUnionBridgeTransferPermissions return UNAUTHORIZED_CALLER when caller is unauthorized', async () => {
            // Assert that no union transferred permissions are stored initially
            await assertNoUnionTransferredPermissionsIsStored(rskClient);

            // Act & Assert
            await rskUtils.assertContractCallFails(
                bridge,
                'setUnionBridgeTransferPermissions',
                [REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED],
                { from: unauthorizedAddress }
            );
        });

        it('should setUnionBridgeTransferPermissions vote be successful when caller is authorized', async () => {
            // Act
            const txReceipt = await setUnionTransferPermissions(
                REQUEST_PERMISSION_DISABLED,
                RELEASE_PERMISSION_DISABLED
            );

            // Assert
            await assertUnionTransferredPermissions(
                rskClient,
                REQUEST_PERMISSION_DISABLED,
                RELEASE_PERMISSION_DISABLED
            );
            await assertLogUnionTransferPermissionsSet(
                txReceipt.transactionHash,
                unionBridgeAuthorizerContractAddress,
                REQUEST_PERMISSION_DISABLED,
                RELEASE_PERMISSION_DISABLED
            );
        });

        it('should requestUnionBridgeRbtc fail when request permission is disabled', async () => {
            // Arrange
            const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await requestUnionBridgeRbtc(
                AMOUNT_TO_REQUEST,
                assertRequestDisabledResponseCode
            );

            // Assert
            await rskUtils.assertNoEventWasEmitted(txReceipt);
            await assertWeisTransferredAndUnionBridgeContractBalance(
                weisTransferredBeforeRequest,
                unionBridgeBalanceBeforeRequest
            );
        });

        it('should increaseUnionBridgeLockingCap vote be successful when transfer permissions are disabled', async () => {
            // Arrange
            const unionLockingCapBeforeUpdate = await getUnionBridgeLockingCap(bridge);
            const newLockingCap = new BN(unionLockingCapBeforeUpdate)
                .mul(new BN(UNION_LOCKING_CAP_INCREMENTS_MULTIPLIER))
                .toString();

            // Act
            const txReceipt = await increaseUnionBridgeLockingCap(newLockingCap);

            // Assert
            assertIncreaseUnionLockingCapExecutedEventWasEmitted(
                unionBridgeAuthorizerContract,
                txReceipt,
                newLockingCap
            );
            await assertLockingCap(rskClient, bridge, newLockingCap);
            await assertLogUnionLockingCapIncreased(
                txReceipt.transactionHash,
                unionLockingCapBeforeUpdate,
                newLockingCap
            );
        });

        it('should setUnionBridgeContractAddressForTestnet be successful when transfer permissions are disabled', async () => {
            // Arrange
            const unionAddressBeforeUpdate = await getUnionBridgeContractAddress(bridge);
            await deployAndFundUnionBridgeContract();

            // Act
            const txReceipt = await setUnionBridgeContractAddressForTestnet(
                unionBridgeContractAddress,
                changeUnionAddressAuthorizerAddress,
                assertSuccessfulResponseCode
            );

            // Assert
            const newUnionAddress = await getUnionBridgeContractAddress(bridge);
            expect(newUnionAddress).to.equal(unionBridgeContractAddress);
            expect(unionAddressBeforeUpdate).to.not.equal(unionBridgeContractAddress);
            await rskUtils.assertNoEventWasEmitted(txReceipt);
        });

        it('should setUnionTransferPermissions vote be successful when voting to enable only request permission', async () => {
            // Act
            const txReceipt = await setUnionTransferPermissions(
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_DISABLED
            );

            // Assert
            await assertUnionTransferredPermissions(
                rskClient,
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_DISABLED
            );
            await assertLogUnionTransferPermissionsSet(
                txReceipt.transactionHash,
                unionBridgeAuthorizerContractAddress,
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_DISABLED
            );
        });

        it('should requestUnionBridgeRbtc be successful when request permission is enabled', async () => {
            // Arrange
            const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await requestUnionBridgeRbtc(
                AMOUNT_TO_REQUEST,
                assertSuccessfulResponseCode
            );

            // Assert
            const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(
                new BN(AMOUNT_TO_REQUEST)
            );
            const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(
                new BN(AMOUNT_TO_REQUEST)
            );
            await assertWeisTransferredAndUnionBridgeContractBalance(
                expectedWeisTransferred,
                expectedUnionBridgeBalance
            );
            await assertLogUnionRbtcRequested(txReceipt.transactionHash, AMOUNT_TO_REQUEST);
        });

        it('should releaseUnionBridgeRbtc fail when release permission is disabled', async () => {
            // Arrange
            const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await releaseUnionBridgeRbtc(
                AMOUNT_TO_RELEASE,
                assertReleaseDisabledResponseCode
            );

            // Assert
            await rskUtils.assertNoEventWasEmitted(txReceipt);
            await assertWeisTransferredAndUnionBridgeContractBalance(
                weisTransferredBeforeRelease,
                unionBridgeBalanceBeforeRelease
            );
        });

        it('should setUnionBridgeTransferPermissions vote be successful when voting to enable only release permission', async () => {
            // Act
            const txReceipt = await setUnionTransferPermissions(
                REQUEST_PERMISSION_DISABLED,
                RELEASE_PERMISSION_ENABLED
            );

            // Assert
            await assertUnionTransferredPermissions(
                rskClient,
                REQUEST_PERMISSION_DISABLED,
                RELEASE_PERMISSION_ENABLED
            );
            await assertLogUnionTransferPermissionsSet(
                txReceipt.transactionHash,
                unionBridgeAuthorizerContractAddress,
                REQUEST_PERMISSION_DISABLED,
                RELEASE_PERMISSION_ENABLED
            );
        });

        it('should requestUnionBridgeRbtc fail when only release permission is enabled', async () => {
            // Arrange
            const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await requestUnionBridgeRbtc(
                AMOUNT_TO_REQUEST,
                assertRequestDisabledResponseCode
            );

            // Assert
            await rskUtils.assertNoEventWasEmitted(txReceipt);
            await assertWeisTransferredAndUnionBridgeContractBalance(
                weisTransferredBeforeRequest,
                unionBridgeBalanceBeforeRequest
            );
        });

        it('should releaseUnionBridgeRbtc be successful when release permission is enabled', async () => {
            // Arrange
            const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await releaseUnionBridgeRbtc(
                AMOUNT_TO_RELEASE,
                assertSuccessfulResponseCode
            );

            // Assert
            const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(
                new BN(AMOUNT_TO_RELEASE)
            );
            const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(
                new BN(AMOUNT_TO_RELEASE)
            );
            await assertWeisTransferredAndUnionBridgeContractBalance(
                expectedWeisTransferredAfter,
                expectedUnionBridgeBalanceAfter
            );
            await assertLogUnionRbtcReleased(txReceipt.transactionHash, AMOUNT_TO_RELEASE);
        });

        it('should setTransferPermissions vote be successful when voting to enable both request and release permissions', async () => {
            // Act
            const txReceipt = await setUnionTransferPermissions(
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_ENABLED
            );

            // Assert
            await assertUnionTransferredPermissions(
                rskClient,
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_ENABLED
            );
            await assertLogUnionTransferPermissionsSet(
                txReceipt.transactionHash,
                unionBridgeAuthorizerContractAddress,
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_ENABLED
            );
        });

        it('should requestUnionBridgeRbtc fail when surpass locking cap', async () => {
            // Arrange
            const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );
            const currentLockingCap = await getUnionBridgeLockingCap(bridge);
            const amountToRequestSurpassingLockingCap = new BN(currentLockingCap).add(new BN(1));

            // Act
            const txReceipt = await requestUnionBridgeRbtc(
                amountToRequestSurpassingLockingCap.toString(),
                assertInvalidValueResponseCode
            );

            // Assert
            await rskUtils.assertNoEventWasEmitted(txReceipt);
            await assertWeisTransferredAndUnionBridgeContractBalance(
                weisTransferredBeforeRequest,
                unionBridgeBalanceBeforeRequest
            );
        });

        it('should releaseUnionBridgeRbtc fail when surpass weisTransferredBalance', async () => {
            // Arrange
            const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );
            const amountToReleaseSurpassingBalance = new BN(weisTransferredBeforeRelease).add(
                new BN(AMOUNT_TO_RELEASE)
            );
            // Add extra funds to simulate the union bridge sending more than the transferred amount
            const unionBridgeContractAddress = await getUnionBridgeContractAddress(bridge);
            await rskUtils.sendFromCow(
                rskTxHelper,
                unionBridgeContractAddress,
                amountToReleaseSurpassingBalance.toString()
            );
            const unionBridgeBalanceAfterFunding = await getUnionBridgeBalance(rskTxHelper, bridge);
            const expectedUnionBridgeBalanceAfterFunding = new BN(
                unionBridgeBalanceBeforeRelease
            ).add(amountToReleaseSurpassingBalance);
            expect(unionBridgeBalanceAfterFunding.toString()).to.equal(
                expectedUnionBridgeBalanceAfterFunding.toString()
            );

            // Act
            const txReceipt = await releaseUnionBridgeRbtc(
                amountToReleaseSurpassingBalance.toString(),
                assertInvalidValueResponseCode
            );
            await assertWeisTransferredAndUnionBridgeContractBalance(
                weisTransferredBeforeRelease,
                unionBridgeBalanceAfterFunding
            );
            await assertLogUnionTransferPermissionsSet(
                txReceipt.transactionHash,
                BRIDGE_ADDRESS,
                REQUEST_PERMISSION_DISABLED,
                RELEASE_PERMISSION_DISABLED
            );
            await assertUnionTransferredPermissions(
                rskClient,
                REQUEST_PERMISSION_DISABLED,
                RELEASE_PERMISSION_DISABLED
            );
        });

        it('should setUnionTransferPermissions vote be successful when voting to enable both permissions after forced pause', async () => {
            // Act
            const txReceipt = await setUnionTransferPermissions(
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_ENABLED
            );

            // Assert
            await assertUnionTransferredPermissions(
                rskClient,
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_ENABLED
            );
            await assertLogUnionTransferPermissionsSet(
                txReceipt.transactionHash,
                unionBridgeAuthorizerContractAddress,
                REQUEST_PERMISSION_ENABLED,
                RELEASE_PERMISSION_ENABLED
            );
        });

        it('should requestUnionBridgeRbtc be successful after force pause', async () => {
            // Arrange
            const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await requestUnionBridgeRbtc(
                AMOUNT_TO_REQUEST,
                assertSuccessfulResponseCode
            );

            // Assert
            const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(
                new BN(AMOUNT_TO_REQUEST)
            );
            const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(
                new BN(AMOUNT_TO_REQUEST)
            );
            await assertWeisTransferredAndUnionBridgeContractBalance(
                expectedWeisTransferred,
                expectedUnionBridgeBalance
            );
            await assertLogUnionRbtcRequested(txReceipt.transactionHash, AMOUNT_TO_REQUEST);
        });

        it('should releaseUnionBridgeRbtc be successful after force pause', async () => {
            // Arrange
            const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge(rskClient);
            const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance(
                rskTxHelper,
                bridge
            );

            // Act
            const txReceipt = await releaseUnionBridgeRbtc(
                AMOUNT_TO_RELEASE,
                assertSuccessfulResponseCode
            );

            // Assert
            const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(
                new BN(AMOUNT_TO_RELEASE)
            );
            const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(
                new BN(AMOUNT_TO_RELEASE)
            );
            await assertWeisTransferredAndUnionBridgeContractBalance(
                expectedWeisTransferredAfter,
                expectedUnionBridgeBalanceAfter
            );
            await assertLogUnionRbtcReleased(txReceipt.transactionHash, AMOUNT_TO_RELEASE);
        });
    });
};

const createAndFundAccounts = async () => {
    const importedNotAuthorizedAddresses = await rskUtils.importAccounts(rskTxHelper, [
        UNAUTHORIZED_1_PRIVATE_KEY,
    ]);
    unauthorizedAddress = importedNotAuthorizedAddresses[0];

    const unionAuthorizedAddresses = await rskUtils.importAccounts(rskTxHelper, [
        CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
        UNION_BRIDGE_AUTHORIZER_1_PK,
        UNION_BRIDGE_AUTHORIZER_2_PK,
        UNION_BRIDGE_AUTHORIZER_3_PK,
        UNION_BRIDGE_AUTHORIZER_DEPLOYER_PK,
    ]);
    changeUnionAddressAuthorizerAddress = unionAuthorizedAddresses[0];
    unionBridgeAuthorizerMember1Address = unionAuthorizedAddresses[1];
    unionBridgeAuthorizerMember2Address = unionAuthorizedAddresses[2];
    unionBridgeAuthorizerMember3Address = unionAuthorizedAddresses[3];
    unionBridgeAuthorizerOwnerAddress = unionAuthorizedAddresses[4];

    // Sending some funds to the not authorized addresses to pay for transaction fees while voting.
    const fundingAmount = btcToWeis(0.1);
    await rskUtils.sendFromCow(rskTxHelper, unauthorizedAddress, fundingAmount);

    // Send some funds to the union authorizers to pay for transaction fees while voting.
    await rskUtils.sendFromCow(rskTxHelper, changeUnionAddressAuthorizerAddress, fundingAmount);
    await rskUtils.sendFromCow(rskTxHelper, unionBridgeAuthorizerMember1Address, fundingAmount);
    await rskUtils.sendFromCow(rskTxHelper, unionBridgeAuthorizerMember2Address, fundingAmount);
    await rskUtils.sendFromCow(rskTxHelper, unionBridgeAuthorizerMember3Address, fundingAmount);
    await rskUtils.sendFromCow(rskTxHelper, unionBridgeAuthorizerOwnerAddress, fundingAmount);
};

const deployAndFundUnionBridgeContract = async () => {
    unionBridgeContractOwnerAddress = await rskUtils.getNewFundedRskAddress(rskTxHelper);
    unionBridgeContract = await deployUnionBridgeContract(
        rskTxHelper,
        unionBridgeContractOwnerAddress
    );
    unionBridgeContractAddress = unionBridgeContract.target;
};

const deployAndInitUnionAuthorizerContract = async () => {
    const multisigMembers = [
        unionBridgeAuthorizerMember1Address,
        unionBridgeAuthorizerMember2Address,
        unionBridgeAuthorizerMember3Address,
    ];

    unionBridgeAuthorizerContract = await deployUnionBridgeAuthorizerContract(
        rskTxHelper,
        unionBridgeAuthorizerOwnerAddress
    );
    unionBridgeAuthorizerContractAddress = unionBridgeAuthorizerContract.target;

    const txReceipt = await rskUtils.sendTransaction(
        rskTxHelper,
        unionBridgeAuthorizerContract,
        'init',
        [multisigMembers, UNION_AUTHORIZER_VOTING_PERIOD_IN_BLOCKS],
        unionBridgeAuthorizerOwnerAddress,
        0,
        300000
    );
    assertUnionAuthorizerInitializedEventWasEmitted(
        unionBridgeAuthorizerContract,
        txReceipt,
        UNION_AUTHORIZER_VOTING_PERIOD_IN_BLOCKS
    );
};

const voteToIncreaseUnionBridgeLockingCap = async (newLockingCap, authorizedMember) => {
    return await rskUtils.sendTransaction(
        rskTxHelper,
        unionBridgeAuthorizerContract,
        'voteToIncreaseUnionLockingCap',
        [newLockingCap],
        authorizedMember,
        0,
        300000
    );
};

const setUnionBridgeContractAddressForTestnet = async (
    newUnionAddress,
    fromAddress,
    checkCallback
) => {
    return rskUtils.sendTxWithCheck(
        rskTxHelper,
        bridge,
        'setUnionBridgeContractAddressForTestnet',
        [newUnionAddress],
        fromAddress,
        checkCallback
    );
};

const increaseUnionBridgeLockingCap = async (newLockingCap) => {
    const txReceiptFirstVote = await voteToIncreaseUnionBridgeLockingCap(
        newLockingCap,
        unionBridgeAuthorizerMember1Address
    );
    assertIncreaseUnionLockingCapVotedEventWasEmitted(
        unionBridgeAuthorizerContract,
        txReceiptFirstVote,
        newLockingCap,
        unionBridgeAuthorizerMember1Address
    );

    const txReceiptSecondVote = await voteToIncreaseUnionBridgeLockingCap(
        newLockingCap,
        unionBridgeAuthorizerMember2Address
    );
    assertIncreaseUnionLockingCapVotedEventWasEmitted(
        unionBridgeAuthorizerContract,
        txReceiptSecondVote,
        newLockingCap,
        unionBridgeAuthorizerMember2Address
    );

    return txReceiptSecondVote;
};

const setUnionTransferPermissions = async (requestEnabled, releaseEnabled) => {
    const txReceiptFirstVote = await voteToSetUnionTransferPermissions(
        requestEnabled,
        releaseEnabled,
        unionBridgeAuthorizerMember1Address
    );
    assertUnionTransferPermissionsVotedEventWasEmitted(
        unionBridgeAuthorizerContract,
        txReceiptFirstVote,
        requestEnabled,
        releaseEnabled,
        unionBridgeAuthorizerMember1Address
    );

    const txReceiptSecondVote = await voteToSetUnionTransferPermissions(
        requestEnabled,
        releaseEnabled,
        unionBridgeAuthorizerMember2Address
    );
    assertUnionTransferPermissionsVotedEventWasEmitted(
        unionBridgeAuthorizerContract,
        txReceiptSecondVote,
        requestEnabled,
        releaseEnabled,
        unionBridgeAuthorizerMember2Address
    );

    assertUnionTransferPermissionsExecutedEventWasEmitted(
        unionBridgeAuthorizerContract,
        txReceiptSecondVote,
        requestEnabled,
        releaseEnabled
    );
    return txReceiptSecondVote;
};

const voteToSetUnionTransferPermissions = async (
    requestEnabled,
    releaseEnabled,
    authorizedMember
) => {
    return await rskUtils.sendTransaction(
        rskTxHelper,
        unionBridgeAuthorizerContract,
        'voteToSetUnionTransferPermissions',
        [requestEnabled, releaseEnabled],
        authorizedMember,
        0,
        300000
    );
};

const requestUnionBridgeRbtcFromUnauthorizedCaller = async (amountToRequest, checkCallback) => {
    // Call the method directly on the bridge contract
    return rskUtils.sendTxWithCheck(
        rskTxHelper,
        bridge,
        'requestUnionBridgeRbtc',
        [amountToRequest],
        unauthorizedAddress,
        checkCallback
    );
};

const requestUnionBridgeRbtc = async (amountToRequest, checkCallback) => {
    return rskUtils.sendTxWithCheck(
        rskTxHelper,
        unionBridgeContract,
        'requestUnionBridgeRbtc',
        [amountToRequest],
        unionBridgeContractOwnerAddress,
        checkCallback
    );
};

const releaseUnionBridgeRbtc = async (amountToRelease, checkCallback) => {
    return rskUtils.sendTxWithCheck(
        rskTxHelper,
        unionBridgeContract,
        'releaseUnionBridgeRbtc',
        [amountToRelease],
        unionBridgeContractOwnerAddress,
        checkCallback
    );
};

const releaseUnionBridgeRbtcFromUnauthorizedCaller = async (amountToRelease, checkCallback) => {
    // Call the method directly on the bridge contract
    const unionResponseCode = await bridge.releaseUnionBridgeRbtc.staticCall({
        from: unauthorizedAddress,
        value: amountToRelease,
    });
    await checkCallback(unionResponseCode);
    return rskUtils.sendTransaction(
        rskTxHelper,
        bridge,
        'releaseUnionBridgeRbtc',
        [],
        unauthorizedAddress,
        amountToRelease
    );
};

const assertLogUnionRbtcRequested = async (txHash, amountRequested) => {
    const expectedEventName = UNION_BRIDGE_EVENTS.UNION_RBTC_REQUESTED.name;
    const foundEvent = await rskUtils.findEventInTx(
        rskTxHelper,
        txHash,
        expectedEventName,
        bridgeContractAbi
    );
    expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be
        .undefined;

    const eventArguments = foundEvent.args;
    expect(eventArguments.requester.toLowerCase()).to.equal(
        unionBridgeContractAddress.toLowerCase()
    );
    expect(eventArguments.amount.toString()).to.equal(amountRequested.toString());
};

const assertLogUnionLockingCapIncreased = async (txHash, previousLockingCap, newLockingCap) => {
    const expectedEventName = UNION_BRIDGE_EVENTS.UNION_LOCKING_CAP_INCREASED.name;
    const foundEvent = await rskUtils.findEventInTx(
        rskTxHelper,
        txHash,
        expectedEventName,
        bridgeContractAbi
    );
    expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be
        .undefined;

    const eventArguments = foundEvent.args;
    expect(eventArguments.caller.toLowerCase()).to.equal(
        unionBridgeAuthorizerContractAddress.toLowerCase()
    );
    expect(eventArguments.previousLockingCap.toString()).to.equal(previousLockingCap.toString());
    expect(eventArguments.newLockingCap.toString()).to.equal(newLockingCap.toString());
};

const assertLogUnionTransferPermissionsSet = async (
    txHash,
    callerAddress,
    requestEnabled,
    releaseEnabled
) => {
    const expectedEventName = UNION_BRIDGE_EVENTS.UNION_BRIDGE_TRANSFER_PERMISSIONS_UPDATED.name;
    const foundEvent = await rskUtils.findEventInTx(
        rskTxHelper,
        txHash,
        expectedEventName,
        bridgeContractAbi
    );
    expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be
        .undefined;

    const eventArguments = foundEvent.args;
    expect(eventArguments.caller.toLowerCase()).to.equal(callerAddress.toLowerCase());
    expect(eventArguments.enablePowPegToUnionBridge).to.equal(requestEnabled);
    expect(eventArguments.enableUnionBridgeToPowPeg).to.equal(releaseEnabled);
};

const assertLogUnionRbtcReleased = async (txHash, amountReleased) => {
    const expectedEventName = UNION_BRIDGE_EVENTS.UNION_RBTC_RELEASED.name;
    const foundEvent = await rskUtils.findEventInTx(
        rskTxHelper,
        txHash,
        expectedEventName,
        bridgeContractAbi
    );
    expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be
        .undefined;

    const eventArguments = foundEvent.args;
    expect(eventArguments.receiver.toLowerCase()).to.equal(
        unionBridgeContractAddress.toLowerCase()
    );
    expect(eventArguments.amount.toString()).to.equal(amountReleased.toString());
};

const assertWeisTransferredAndUnionBridgeContractBalance = async (
    expectedWeisTransferred,
    expectedUnionBridgeBalance
) => {
    await assertWeisTransferredToUnionBridge(rskTxHelper.getClient(), expectedWeisTransferred);
    await assertUnionBridgeBalance(rskTxHelper, bridge, expectedUnionBridgeBalance);
};

module.exports = {
    execute,
};
