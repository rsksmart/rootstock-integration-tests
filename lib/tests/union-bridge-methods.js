const rskUtils = require('../rsk-utils');
const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

const { getRskTransactionHelpers} = require('../rsk-tx-helper-provider');
const { getBtcClient } = require('../btc-client-provider');
const { getBridge } = require('../bridge-provider');
const { sendTxWithCheck, getNewFundedRskAddress, sendTransaction, sendFromCow} = require('../rsk-utils');
const { ensure0x } = require('../utils');

// Import constants
const {
  UNION_BRIDGE_ADDRESS,
  INITIAL_LOCKING_CAP,
  LOCKING_CAP_INCREMENTS_MULTIPLIER,
  CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PUBKEY,
  CHANGE_LOCKING_CAP_AUTHORIZERS_PUBKEYS,
  CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PUBKEYS,
  UNION_BRIDGE_EVENTS,
  UNION_BRIDGE_STORAGE_INDICES,
  UNION_RESPONSE_CODES
} = require('../constants/union-bridge-constants');
const {btcToWeis, weisToEth, ethToWeis} = require("@rsksmart/btc-eth-unit-converter");
const { deployCallUnionBridgeMethodsContract} = require("../contractDeployer");
const {BRIDGE_ADDRESS} = require("../constants/bridge-constants");

// Define variables to be used across tests


// Define constants for the tests
const AMOUNT_TO_REQUEST = btcToWeis(1); // 1 BTC in wei
const AMOUNT_TO_RELEASE = btcToWeis(1); // 1 BTC in wei;

const NOT_AUTHORIZED_1_PRIVATE_KEY = 'bb7a53f495b863a007a3b1e28d2da2a5ec0343976a9be64e6fcfb97791b0112b';

// Calculate locking cap values
const INITIAL_MAX_LOCKING_CAP_INCREMENT = ethToWeis(Number(weisToEth(INITIAL_LOCKING_CAP)) * LOCKING_CAP_INCREMENTS_MULTIPLIER);
const NEW_LOCKING_CAP = ethToWeis(weisToEth(INITIAL_MAX_LOCKING_CAP_INCREMENT) - 20);
const DIFFERENT_LOCKING_CAP_FOR_VOTING = INITIAL_MAX_LOCKING_CAP_INCREMENT;

const importAccounts = async (rskTxHelper, privateKeys) => {
  const importedAddresses = [];
  for (const privateKey of privateKeys) {
    const address = await rskTxHelper.importAccount(privateKey);
    importedAddresses.push(address);
  }
  return importedAddresses;
};

const execute = (description) => {
  let rskTxHelpers;
  let rskTxHelper;
  let btcTxHelper;
  let bridge;

  let changeUnionAddressAuthorizerAddress;
  let changeLockingCapAuthorizer1Address;
  let changeLockingCapAuthorizer2Address;
  let changeTransferPermissionsAuthorizer1Address;
  let changeTransferPermissionsAuthorizer2Address;

  let notAuthorizedAddress;

  let reed800IsActive;

  let initialUnionBridgeAddress = UNION_BRIDGE_ADDRESS;
  let newUnionBridgeContractAddress;

  let callUnionBridgeMethodsContractCreatorAddress;
  let callUnionBridgeMethodsContract;

  describe(description, function () {
    before(async () => {
      // Initialize helpers and bridge
      btcTxHelper = getBtcClient();
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      bridge = await getBridge(rskTxHelper.getClient());

      // Create accounts for the authorizers
      const unionAuthorizedAddresses = await importAccounts(rskTxHelper, [
        CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PUBKEY,
        ...CHANGE_LOCKING_CAP_AUTHORIZERS_PUBKEYS,
        ...CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PUBKEYS
      ]);
      changeUnionAddressAuthorizerAddress = unionAuthorizedAddresses[0];
      changeLockingCapAuthorizer1Address = unionAuthorizedAddresses[1];
      changeLockingCapAuthorizer2Address = unionAuthorizedAddresses[2];
      changeTransferPermissionsAuthorizer1Address = unionAuthorizedAddresses[3];
      changeTransferPermissionsAuthorizer2Address = unionAuthorizedAddresses[4];

      // Send some funds to the union authorizers to pay for transaction fees while voting.
      await rskUtils.sendFromCow(rskTxHelper, changeUnionAddressAuthorizerAddress, btcToWeis(0.1));
      await rskUtils.sendFromCow(rskTxHelper, changeLockingCapAuthorizer1Address, btcToWeis(0.1));
      await rskUtils.sendFromCow(rskTxHelper, changeLockingCapAuthorizer2Address, btcToWeis(0.1));
      await rskUtils.sendFromCow(rskTxHelper, changeTransferPermissionsAuthorizer1Address, btcToWeis(0.1));
      await rskUtils.sendFromCow(rskTxHelper, changeTransferPermissionsAuthorizer2Address, btcToWeis(0.1));

      const importedNotAuthorizedAddresses = await importAccounts(rskTxHelper, [NOT_AUTHORIZED_1_PRIVATE_KEY]);
      notAuthorizedAddress = importedNotAuthorizedAddresses[0];
      // Sending some funds to the not authorized addresses to pay for transaction fees while voting.
      // This is done to realistically test the union bridge methods, so it doesn't fail by something else like insufficient funds.
      await rskUtils.sendFromCow(rskTxHelper, notAuthorizedAddress, btcToWeis(0.1));

      reed800IsActive = await Runners.common.forks.reed800.isAlreadyActive();

      callUnionBridgeMethodsContractCreatorAddress = await getNewFundedRskAddress(rskTxHelper);
      // send some funds to pay for transaction fees
      await rskUtils.sendFromCow(rskTxHelper, callUnionBridgeMethodsContractCreatorAddress, btcToWeis(0.5));

      callUnionBridgeMethodsContract = await deployCallUnionBridgeMethodsContract(rskTxHelper, callUnionBridgeMethodsContractCreatorAddress);
      newUnionBridgeContractAddress = callUnionBridgeMethodsContract._address;
    });

    it('should change union address when trying to set union bridge contract address for testnet', async () => {
      // Assert that union address is equal to the constant address before the update
      const unionAddressBeforeUpdate = await getUnionBridgeContractAddress();
      expect(unionAddressBeforeUpdate).to.equal(initialUnionBridgeAddress);

      // Act
      await updateUnionAddress(newUnionBridgeContractAddress, changeUnionAddressAuthorizerAddress, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      const actualUnionAddress = await getUnionBridgeContractAddress();
      expect(actualUnionAddress).to.equal(newUnionBridgeContractAddress);
    });

    it('should fail and return UNAUTHORIZED_CALLER when increasing union bridge locking cap without authorization', async () => {
      const actualUnionLockingCap = await getUnionBridgeLockingCap();
      expect(actualUnionLockingCap).to.equal(INITIAL_LOCKING_CAP);
      // Act
      await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP, notAuthorizedAddress, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.UNAUTHORIZED_CALLER);
      });
      // Assert that the locking cap remains unchanged
      const lockingCapAfterAttempt = await getUnionBridgeLockingCap();
      expect(lockingCapAfterAttempt).to.equal(INITIAL_LOCKING_CAP);
    });

    it('should vote successfully when first vote to increase union bridge locking cap', async () => {
      // Act
      await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP.toString(), changeLockingCapAuthorizer1Address, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert locking cap remains unchanged after first vote
      const actualUnionLockingCap = await getUnionBridgeLockingCap();
      expect(actualUnionLockingCap).to.equal(INITIAL_LOCKING_CAP.toString());
    });

    it('should vote successfully when second vote for different value to increase union bridge locking cap', async () => {
      // Act
      await increaseUnionBridgeLockingCap(DIFFERENT_LOCKING_CAP_FOR_VOTING, changeLockingCapAuthorizer2Address, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert that the locking cap remains unchanged
      const actualUnionLockingCap = await getUnionBridgeLockingCap();
      expect(actualUnionLockingCap).to.equal(INITIAL_LOCKING_CAP);
    });

    it('should vote successfully and update locking cap when third vote for same value', async () => {
      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP, changeLockingCapAuthorizer2Address, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      await assertLockingCap(NEW_LOCKING_CAP);
      await assertUnionLockingCapIncreasedEventWasEmitted(txReceipt.blockNumber, changeLockingCapAuthorizer2Address, INITIAL_LOCKING_CAP, NEW_LOCKING_CAP);
    });

    it('should vote successfully but not change locking cap when voting again for previous different value after election clear', async () => {
      // Arrange
      const lockingCapBeforeUpdate = await getUnionBridgeLockingCap();

      // Act
      await increaseUnionBridgeLockingCap(DIFFERENT_LOCKING_CAP_FOR_VOTING, changeLockingCapAuthorizer1Address, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      await assertLockingCap(lockingCapBeforeUpdate);
    });

    it('should return INVALID_VALUE when trying to set a smaller locking cap', async () => {
      // Act
      await increaseUnionBridgeLockingCap(INITIAL_LOCKING_CAP, changeLockingCapAuthorizer1Address, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.INVALID_VALUE);
      });

      // Assert that the locking cap remains unchanged
      await assertLockingCap(NEW_LOCKING_CAP);
    });

    it('should return UNAUTHORIZED_CALLER when requesting union bridge RBTC without authorization', async () => {
      // Arrange
      const expectedZeroBalance = ethToWeis(0);
      await assertWeisTransferredToUnionBridge(expectedZeroBalance);
      await assertUnionBridgeBalance(expectedZeroBalance);

      // Act
      await requestUnionRbtcFromUnauthorizedCaller(AMOUNT_TO_REQUEST, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.UNAUTHORIZED_CALLER);
      });

      // Assert
      await assertWeisTransferredToUnionBridge(expectedZeroBalance);
      await assertUnionBridgeBalance(expectedZeroBalance);
    });

    it('should request union bridge RBTC when authorized', async () => {
      // Act
      await requestUnionRbtc(AMOUNT_TO_REQUEST, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      await assertWeisTransferredToUnionBridge(AMOUNT_TO_REQUEST);
      await assertUnionBridgeBalance(AMOUNT_TO_REQUEST);
    });

    it('should return UNAUTHORIZED_CALLER when releasing union bridge RBTC without authorization', async () => {
      const weisTransferredBalanceBeforeAttemptToRelease = await getWeisTransferredBalance();

      // Act
      await releaseUnionRbtcFromUnauthorizedCaller(AMOUNT_TO_RELEASE, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.UNAUTHORIZED_CALLER);
      });

      // Assert that the weis transferred balance and union bridge balance remain unchanged
      await assertWeisTransferredToUnionBridge(weisTransferredBalanceBeforeAttemptToRelease);
      await assertUnionBridgeBalance(weisTransferredBalanceBeforeAttemptToRelease);
    });

    it('should release union bridge RBTC when authorized', async () => {
      // Arrange
      const balanceBeforeRelease = await getWeisTransferredBalance();

      // Act
      const releaseUnionRskTx = await releaseUnionRbtc(AMOUNT_TO_RELEASE, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      const expectedBalance = ethToWeis(Number(weisToEth(balanceBeforeRelease)) - Number(weisToEth(AMOUNT_TO_RELEASE)));
      await assertUnionBridgeBalance(expectedBalance);
      await assertUnionRbtcReleasedEventWasEmitted(releaseUnionRskTx.blockNumber, newUnionBridgeContractAddress, expectedBalance);
    });

    // Tests for transfer permissions
    it('should return UNAUTHORIZED_CALLER when setting transfer permissions without authorization', async () => {
      const requestEnabled = await getUnionBridgeRequestEnabled();
      const releaseEnabled = await getUnionBridgeReleaseEnabled();

      // Assert permissions are enabled by default
      expect(requestEnabled).to.equal(true);
      expect(releaseEnabled).to.equal(true);

      // Act
      await setUnionTransferPermissions(false, false, notAuthorizedAddress, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.UNAUTHORIZED_CALLER);
      });

      // Assert request and release permissions remain unchanged
      await assertTransferPermissions(requestEnabled, releaseEnabled);
    });

    it('should vote successfully when first vote to set transfer permissions', async () => {
      // Arrange
      const requestEnabled = await getUnionBridgeRequestEnabled();
      const releaseEnabled = await getUnionBridgeReleaseEnabled();

      // Assert permissions are enabled by default
      expect(requestEnabled).to.equal(true);
      expect(releaseEnabled).to.equal(true);

      // Act
      await setUnionTransferPermissions(false, false, changeTransferPermissionsAuthorizer1Address, (unionTransferPermissionsResponseCode) => {
        expect(unionTransferPermissionsResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert request and release permissions remain unchanged
      await assertTransferPermissions(requestEnabled, releaseEnabled);
    });

    it('should vote successfully when second vote for different value to set transfer permissions', async () => {
      // Arrange
      const requestEnabled = await getUnionBridgeRequestEnabled();
      const releaseEnabled = await getUnionBridgeReleaseEnabled();

      // Act
      await setUnionTransferPermissions(false, true, changeTransferPermissionsAuthorizer2Address, (unionTransferPermissionsResponseCode) => {
        expect(unionTransferPermissionsResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert request and release permissions remain unchanged
      await assertTransferPermissions(requestEnabled, releaseEnabled);
    });

    it('should vote successfully and update transfer permissions when third vote for same value', async () => {
      // Arrange
      const defaultRequestEnabled = await getUnionBridgeRequestEnabled();
      const defaultReleaseEnabled = await getUnionBridgeReleaseEnabled();

      // Act
      const transactionReceipt = await setUnionTransferPermissions(false, false, changeTransferPermissionsAuthorizer2Address, (unionTransferPermissionsResponseCode) => {
        expect(unionTransferPermissionsResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      expect(defaultRequestEnabled).to.not.equal(false);
      expect(defaultReleaseEnabled).to.not.equal(false);
      await assertTransferPermissions(false, false);
      await assertUnionTransferPermissionsUpdatedEventWasEmitted(transactionReceipt.blockNumber, changeTransferPermissionsAuthorizer2Address, false, false);
    });

    it('should return REQUEST_DISABLED when requesting union bridge RBTC when request is disabled', async () => {
      // Arrange
      const weisTransferredBalanceBeforeRequest = await getWeisTransferredBalance();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();

      // Act
      const txReceipt = await requestUnionRbtc(AMOUNT_TO_REQUEST, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.REQUEST_DISABLED);
      });

      // Assert balance remains unchanged
      await assertWeisTransferredToUnionBridge(weisTransferredBalanceBeforeRequest);
      await assertUnionBridgeBalance(unionBridgeBalanceBeforeRequest);
      // Assert that no events were emitted
      expect(txReceipt.events.length).to.equal(0);
    });

    it('should vote successfully when first vote to increase locking cap while transfer is disabled', async () => {
      // Arrange
      const lockingCapBeforeIncrement = await getUnionBridgeLockingCap();

      const newLockingCap = ethToWeis(Number(weisToEth(NEW_LOCKING_CAP)) * Number(LOCKING_CAP_INCREMENTS_MULTIPLIER));

      // Act
      await increaseUnionBridgeLockingCap(newLockingCap, changeLockingCapAuthorizer1Address, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert locking cap remains unchanged
      const actualLockingCap = await getUnionBridgeLockingCap();
      expect(actualLockingCap).to.equal(lockingCapBeforeIncrement);
    });

    it('should increment locking cap when second vote while transfer is disabled', async () => {
      // Arrange
      const newLockingCap = ethToWeis(Number(weisToEth(NEW_LOCKING_CAP)) * Number(LOCKING_CAP_INCREMENTS_MULTIPLIER));

      // Act
      await increaseUnionBridgeLockingCap(newLockingCap, changeLockingCapAuthorizer2Address, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      await assertLockingCap(newLockingCap);
    });

    it('should allow to update union address when transfer is disabled', async () => {
      // Arrange
      const unionAddressBeforeUpdate = await getUnionBridgeContractAddress();
      callUnionBridgeMethodsContract = await deployCallUnionBridgeMethodsContract(rskTxHelper, callUnionBridgeMethodsContractCreatorAddress);
      newUnionBridgeContractAddress = callUnionBridgeMethodsContract._address;

      // Act
      await updateUnionAddress(newUnionBridgeContractAddress, changeUnionAddressAuthorizerAddress, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      const unionAddressAfterUpdate = await getUnionBridgeContractAddress();
      expect(unionAddressAfterUpdate).to.equal(newUnionBridgeContractAddress);
      expect(unionAddressBeforeUpdate).to.not.equal(unionAddressAfterUpdate);
    });

    // Tests for enabling only request permission
    it('should vote successfully when first vote to enable only request permission', async () => {
      // Arrange
      const requestEnabled = await getUnionBridgeRequestEnabled();
      const releaseEnabled = await getUnionBridgeReleaseEnabled();
      // Assert permissions are disabled
      expect(requestEnabled).to.equal(false);
      expect(releaseEnabled).to.equal(false);

      // Act
      await setUnionTransferPermissions(true, false, changeTransferPermissionsAuthorizer1Address, (unionTransferPermissionsResponseCode) => {
        expect(unionTransferPermissionsResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert request and release permissions remain unchanged
      await assertTransferPermissions(false, false);
    });

    it('should update permissions when second vote to enable only request permission', async () => {
      // Act
      const txReceipt = await setUnionTransferPermissions(true, false, changeTransferPermissionsAuthorizer2Address, (unionTransferPermissionsResponseCode) => {
        expect(unionTransferPermissionsResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      await assertTransferPermissions(true, false);
      await assertUnionTransferPermissionsUpdatedEventWasEmitted(txReceipt.blockNumber, changeTransferPermissionsAuthorizer2Address, true, false);
    });

    it('requestUnionRbtc should work when request permission is enabled', async () => {
      // Arrange
      const weisTransferredBalanceBeforeRequest = await getWeisTransferredBalance();

      // Act
      await requestUnionRbtc(AMOUNT_TO_REQUEST, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      const expectedWeisTransferredBalance = additionInWeis(weisTransferredBalanceBeforeRequest, AMOUNT_TO_REQUEST);
      await assertWeisTransferredToUnionBridge(expectedWeisTransferredBalance);
      await assertUnionBridgeBalance(expectedWeisTransferredBalance);
    });

    it('releaseUnionRbtc should return RELEASE_DISABLED when release permission is disabled', async () => {
      // Arrange
      const weisTransferredBalanceBeforeRelease = await getWeisTransferredBalance();
      const releaseEnabled = await getUnionBridgeReleaseEnabled();
      expect(releaseEnabled).to.equal(false);

      // Act
      const txReceipt = await releaseUnionRbtc(AMOUNT_TO_RELEASE, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.RELEASE_DISABLED);
      });

      // Assert
      await assertWeisTransferredToUnionBridge(weisTransferredBalanceBeforeRelease);
      await assertUnionBridgeBalance(weisTransferredBalanceBeforeRelease);
      // Assert that no events were emitted
      expect(txReceipt.events.length).to.equal(0);
    });

    // Tests for enabling only release permission
    it('should vote successfully when first vote to enable only release permission', async () => {
      // Arrange
      const requestEnabled = await getUnionBridgeRequestEnabled();
      const releaseEnabled = await getUnionBridgeReleaseEnabled();
      expect(requestEnabled).to.equal(true);
      expect(releaseEnabled).to.equal(false);

      // Act
      const txReceipt = await setUnionTransferPermissions(false, true, changeTransferPermissionsAuthorizer1Address, (actualResponseCode) => {
        expect(actualResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert transfer permissions remain unchanged
      await assertTransferPermissions(requestEnabled, releaseEnabled);

      // Assert no events were emitted
      expect(txReceipt.events.length).to.equal(0);
    });

    it('should update permissions when second vote to enable only release permission', async () => {
      // Act
      const txReceipt = await setUnionTransferPermissions(false, true, changeTransferPermissionsAuthorizer1Address, (actualResponseCode) => {
        expect(actualResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      await assertTransferPermissions(false, true);
      await assertUnionTransferPermissionsUpdatedEventWasEmitted(txReceipt.blockNumber, changeTransferPermissionsAuthorizer1Address, false, true);
    });

    it('should return REQUEST_DISABLED when requesting union bridge RBTC when request is disabled', async () => {
      const balanceBeforeRequest = await getWeisTransferredBalance();
      const unionBalanceBeforeRequest = await getUnionBridgeBalance();

      // Act
      await requestUnionRbtc(AMOUNT_TO_REQUEST, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.REQUEST_DISABLED);
      });

      // Assert
      await assertWeisTransferredToUnionBridge(balanceBeforeRequest);
      await assertUnionBridgeBalance(unionBalanceBeforeRequest);
    });

    it('should release union bridge RBTC when release is enabled', async () => {
      // Arrange
      const expectedBalanceBeforeRelease = AMOUNT_TO_RELEASE;
      await assertUnionBridgeBalance(expectedBalanceBeforeRelease);
      await assertWeisTransferredToUnionBridge(expectedBalanceBeforeRelease);

      // Act
      const txReceipt = await releaseUnionRbtc(AMOUNT_TO_RELEASE, (actualResponseCode) => {
        expect(actualResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      await assertUnionRbtcReleasedEventWasEmitted(txReceipt.blockNumber, newUnionBridgeContractAddress, AMOUNT_TO_RELEASE);

      const expectedBalance = ethToWeis(0);
      await assertWeisTransferredToUnionBridge(expectedBalance);
      await assertUnionBridgeBalance(expectedBalance);
    });

    // Tests for enabling both permissions
    it('should vote successfully when first vote to enable both permissions', async () => {
      // Arrange
      const requestEnabled = await getUnionBridgeRequestEnabled();
      const releaseEnabled = await getUnionBridgeReleaseEnabled();

      expect(requestEnabled).to.equal(false);
      expect(releaseEnabled).to.equal(true);

      // Act
      const txReceipt = await setUnionTransferPermissions(true, true, changeTransferPermissionsAuthorizer1Address, (actualResponseCode) => {
        expect(actualResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert no events were emitted
      expect(txReceipt.events.length).to.equal(0);
      // Assert transfer permissions remain unchanged
      await assertTransferPermissions(false, true);
    });

    it('should update permissions when second vote to enable both permissions', async () => {
      // Act
      const txReceipt = await setUnionTransferPermissions(true, true, changeTransferPermissionsAuthorizer2Address, (actualResponseCode) => {
        expect(actualResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      });

      // Assert
      await assertTransferPermissions(true, true);
      await assertUnionTransferPermissionsUpdatedEventWasEmitted(txReceipt.blockNumber, changeTransferPermissionsAuthorizer2Address, true, true);
    });

    // Tests for edge cases
    it('should return INVALID_VALUE when requesting more than locking cap', async () => {
      // Arrange
      const currentLockingCap = await getUnionBridgeLockingCap();
      const amountToRequest = BigInt(currentLockingCap) + BigInt(1); // Request more than the locking cap

      // Act
      const requestUnionResponseCode = await requestUnionRbtc(amountToRequest.toString(), caller);

      // Assert
      expect(requestUnionResponseCode).to.equal(UNION_RESPONSE_CODES.INVALID_VALUE);
    });

    it('should return INVALID_VALUE and disable permissions when releasing more than weis transferred balance', async () => {
      // Arrange
      await assertWeisTransferredToUnionBridge(0);
      // Act
      const releaseUnionResponseCode = await releaseUnionRbtc(AMOUNT_TO_RELEASE, caller);

      // Assert
      expect(releaseUnionResponseCode).to.equal(UNION_RESPONSE_CODES.INVALID_VALUE);
      await assertWeisTransferredToUnionBridge(0);
    });

    // Tests for re-enabling permissions after force pause
    it('should vote successfully when first vote to enable back both permissions', async () => {
      // Arrange

      // Act
      const unionTransferPermissionsResponseCode = await setUnionTransferPermissions(true, true, caller);

      // Assert
      expect(unionTransferPermissionsResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
    });

    it('should update permissions when second vote to enable back both permissions', async () => {
      // Arrange

      // Act
      const unionTransferPermissionsResponseCode = await setUnionTransferPermissions(true, true, caller);

      // Assert
      expect(unionTransferPermissionsResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
    });

    it('should request union bridge RBTC when permissions enabled after force pause', async () => {
      // Arrange
      await assertWeisTransferredToUnionBridge(0);

      // Act
      const requestUnionResponseCode = await requestUnionRbtc(AMOUNT_TO_REQUEST, caller);
      currentWeisTransferredBalance = BigInt(AMOUNT_TO_REQUEST);

      // Assert
      expect(requestUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      await assertWeisTransferredToUnionBridge(AMOUNT_TO_REQUEST);
      await assertUnionBridgeBalance(AMOUNT_TO_REQUEST);
    });

    it('should release union bridge RBTC when permissions enabled after force pause', async () => {
      // Arrange

      // Act
      const releaseUnionResponseCode = await releaseUnionRbtc(AMOUNT_TO_RELEASE, caller);
      currentWeisTransferredBalance = BigInt(0);

      // Assert
      expect(releaseUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
      await assertWeisTransferredToUnionBridge(0);
      await assertUnionBridgeBalance(0);
    });

    const additionInWeis = async (amountInWeis, secondAmountInWeis) => {
      return ethToWeis(Number(weisToEth(amountInWeis)) + Number(weisToEth(secondAmountInWeis)));
    }

    // Helper functions for bridge method calls
    const getUnionBridgeContractAddress = async () => {
      return await bridge.methods.getUnionBridgeContractAddress().call();
    };

    const getUnionBridgeLockingCap = async () => {
      return await bridge.methods.getUnionBridgeLockingCap().call();
    };

    const increaseUnionBridgeLockingCap = async (newLockingCap, fromAddress, checkCallback) => {
      const method = bridge.methods.increaseUnionBridgeLockingCap(newLockingCap);
      return sendTxWithCheck(rskTxHelper, method, fromAddress, checkCallback);
    };

    const requestUnionRbtc = async (amountToRequest, checkCallback) => {
      const method = callUnionBridgeMethodsContract.methods.requestUnionRBTC(amountToRequest);
      return sendTxWithCheck(rskTxHelper, method, callUnionBridgeMethodsContractCreatorAddress, checkCallback);
    };

    const requestUnionRbtcFromUnauthorizedCaller = async (amountToRequest, checkCallback) => {
      // Call the method directly on the bridge contract
      const method = bridge.methods.requestUnionBridgeRbtc(amountToRequest);
      return sendTxWithCheck(rskTxHelper, method, callUnionBridgeMethodsContractCreatorAddress, checkCallback);
    };

    const releaseUnionRbtc = async (amountToRelease, checkCallback) => {
      const method = callUnionBridgeMethodsContract.methods.releaseUnionRBTC();
      const result = await method.call({ from: callUnionBridgeMethodsContractCreatorAddress, value: amountToRelease });
      await checkCallback(result);
      return await sendTransaction(rskTxHelper, method, callUnionBridgeMethodsContractCreatorAddress, amountToRelease);
    };

    const releaseUnionRbtcFromUnauthorizedCaller = async (amountToRelease, checkCallback) => {
      // Call the method directly on the bridge contract
      const method = bridge.methods.releaseUnionBridgeRbtc();
      const result = await method.call({ from: callUnionBridgeMethodsContractCreatorAddress, value: amountToRelease });
      await checkCallback(result);
      return await sendTransaction(rskTxHelper, method, callUnionBridgeMethodsContractCreatorAddress, amountToRelease);
    };

    const setUnionTransferPermissions = async (requestEnabled, releaseEnabled, fromAddress, checkCallback) => {
      const method = bridge.methods.setUnionBridgeTransferPermissions(requestEnabled, releaseEnabled);
      return sendTxWithCheck(rskTxHelper, method, fromAddress, checkCallback);
    };

    const getWeisTransferredBalance = async () => {
      return await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.WEIS_TRANSFERRED_TO_UNION_BRIDGE);
    };

    const updateUnionAddress = async (newUnionAddress, fromAddress, checkCallback) => {
      const method = bridge.methods.setUnionBridgeContractAddressForTestnet(newUnionAddress);
      return sendTxWithCheck(rskTxHelper, method, fromAddress, checkCallback);
    };

    const getUnionBridgeBalance = async () => {
      return rskTxHelper.getClient().eth.getBalance(BRIDGE_ADDRESS);
    }

    const assertUnionBridgeBalance = async (expectedBalance) => {
      const actualBalance = await rskTxHelper.getClient().eth.getBalance(initialUnionBridgeAddress);
      expect(actualBalance).to.equal(expectedBalance);
    };

    const assertWeisTransferredToUnionBridge = async (expectedAmount) => {
      const currentWeisTransferredBalance = await getWeisTransferredBalance();
      expect(currentWeisTransferredBalance).to.equal(ensure0x(expectedAmount));
    };

    const assertLockingCap = async (expectedLockingCap) => {
      const actualLockingCap = await getUnionBridgeLockingCap();
      expect(actualLockingCap).to.equal(expectedLockingCap);
    };

    const getUnionBridgeRequestEnabled = async () => {
      return rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_REQUEST_ENABLED)
    }

    const getUnionBridgeReleaseEnabled = async () => {
      return rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_RELEASE_ENABLED)
    }

    const assertUnionRbtcRequestedEventWasEmitted = async (blockBeforeRequest, blockAfterRequest, expectedRequester, expectedAmount) => {
      const unionRbtcRequestedEvent = await rskUtils.findEventInBlock(rskTxHelper, UNION_BRIDGE_EVENTS.UNION_RBTC_REQUESTED.name, blockBeforeRequest, blockAfterRequest);
      expect(unionRbtcRequestedEvent).to.not.be.null;

      expect(unionRbtcRequestedEvent.arguments.requester).to.equal(expectedRequester);
      expect(unionRbtcRequestedEvent.arguments.amount).to.equal(expectedAmount);
    }

    const assertUnionRbtcReleasedEventWasEmitted = async (blockBeforeRelease, expectedReceiver, expectedAmount) => {
      const unionRbtcReleasedEvent = await rskUtils.findEventInBlock(rskTxHelper, UNION_BRIDGE_EVENTS.UNION_RBTC_RELEASED.name, blockBeforeRelease);
      expect(unionRbtcReleasedEvent).to.not.be.null;

      const normalizedReceiverAddress = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(expectedReceiver));
      expect(unionRbtcReleasedEvent.arguments.receiver).to.equal(normalizedReceiverAddress);
      expect(unionRbtcReleasedEvent.arguments.amount).to.equal(expectedAmount);
    }

    const assertUnionLockingCapIncreasedEventWasEmitted = async (rskTxBlockNumber, expectedCaller, expectedPreviousLockingCap, expectedNewLockingCap) => {
      const unionLockingCapIncreasedEvent = await rskUtils.findEventInBlock(rskTxHelper, UNION_BRIDGE_EVENTS.UNION_LOCKING_CAP_INCREASED.name, rskTxBlockNumber);
      expect(unionLockingCapIncreasedEvent).to.not.be.null;

      const normalizedCallerAddress = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(expectedCaller));
      expect(unionLockingCapIncreasedEvent.arguments.caller).to.equal(normalizedCallerAddress);
      expect(unionLockingCapIncreasedEvent.arguments.previousLockingCap).to.equal(expectedPreviousLockingCap);
      expect(unionLockingCapIncreasedEvent.arguments.newLockingCap).to.equal(expectedNewLockingCap);
    }

    const assertUnionTransferPermissionsUpdatedEventWasEmitted = async (rskTxBlockNumber, expectedCaller, expectedRequestEnabled, expectedReleaseEnabled) => {
      const unionTransferPermissionsSetEvent = await rskUtils.findEventInBlock(rskTxHelper, UNION_BRIDGE_EVENTS.UNION_BRIDGE_TRANSFER_PERMISSIONS_UPDATED.name, rskTxBlockNumber);
      expect(unionTransferPermissionsSetEvent).to.not.be.null;

      const normalizedCallerAddress = rskTxHelper.getClient().utils.toChecksumAddress(ensure0x(expectedCaller));
      expect(unionTransferPermissionsSetEvent.arguments.caller).to.equal(normalizedCallerAddress);
      expect(unionTransferPermissionsSetEvent.arguments.enablePowPegToUnionBridge).to.equal(expectedRequestEnabled);
      expect(unionTransferPermissionsSetEvent.arguments.enableUnionBridgeToPowPeg).to.equal(expectedReleaseEnabled);
    }

    const assertTransferPermissions = async (expectedRequestEnabled, expectedReleaseEnabled) => {
      const actualRequestEnabled = await getUnionBridgeRequestEnabled()
      const actualReleaseEnabled = await getUnionBridgeReleaseEnabled();
      expect(actualRequestEnabled).to.equal(expectedRequestEnabled);
      expect(actualReleaseEnabled).to.equal(expectedReleaseEnabled);
    }
  });
};

module.exports = {
  execute
};