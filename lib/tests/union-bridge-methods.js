const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const BN = require("bn.js");

const rskUtils = require('../rsk-utils');

const BridgeTransactionParser = require("@rsksmart/bridge-transaction-parser");
const {getBridge} = require("../bridge-provider");
const {getRskTransactionHelpers} = require("../rsk-tx-helper-provider");

const {btcToWeis, ethToWeis, weisToEth} = require("@rsksmart/btc-eth-unit-converter");

const {
  CHANGE_LOCKING_CAP_AUTHORIZERS_PKS,
  CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
  CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PKS,
  UNION_RESPONSE_CODES,
  UNION_BRIDGE_ADDRESS,
  UNION_BRIDGE_STORAGE_INDICES,
  INITIAL_LOCKING_CAP,
  LOCKING_CAP_INCREMENTS_MULTIPLIER,
  UNION_BRIDGE_EVENTS
} = require("../constants/union-bridge-constants");

const {deployUnionBridgeContract} = require("../contractDeployer");
const {BRIDGE_ADDRESS} = require("../constants/bridge-constants");
const {getBridgeStorageValueDecodedHexString, removePrefix0x} = require("../utils");

const NO_VALUE = "0x0";
const UNAUTHORIZED_1_PRIVATE_KEY = 'bb7a53f495b863a007a3b1e28d2da2a5ec0343976a9be64e6fcfb97791b0112b';

const INITIAL_MAX_LOCKING_CAP_INCREMENT = ethToWeis(Number(weisToEth(INITIAL_LOCKING_CAP)) * LOCKING_CAP_INCREMENTS_MULTIPLIER);
const NEW_LOCKING_CAP_1 = ethToWeis(weisToEth(INITIAL_MAX_LOCKING_CAP_INCREMENT) - 20);
const NEW_LOCKING_CAP_2 = ethToWeis(weisToEth(INITIAL_MAX_LOCKING_CAP_INCREMENT) - 10);

const AMOUNT_TO_REQUEST = btcToWeis(2);
const AMOUNT_TO_RELEASE = btcToWeis(1);

const REQUEST_PERMISSION_ENABLED = true;
const REQUEST_PERMISSION_DISABLED = false;
const RELEASE_PERMISSION_ENABLED = true;
const RELEASE_PERMISSION_DISABLED = false;

let rskTxHelpers;
let rskTxHelper;
let bridge;
let bridgeTxParser;

let changeUnionAddressAuthorizerAddress;
let changeLockingCapAuthorizerAddress;
let changeTransferPermissionsAuthorizerAddress;

let unauthorizedAddress;

let unionBridgeContractCreatorAddress;
let unionBridgeContract;
let newUnionBridgeContractAddress;

const execute = (description) => {
  describe(description, () => {
    before(async () => {
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      bridge = await getBridge(rskTxHelper.getClient());

      bridgeTxParser = new BridgeTransactionParser(rskTxHelper.getClient());

      // Create accounts for the authorizers
      await createAndFundAccounts();
      await deployAndFundUnionBridgeContract();
    });

    it('should setUnionBridgeContractAddressForTestnet change union address when calling on regtest', async () => {
      // Arrange
      const unionBridgeAddressBeforeUpdate = await getUnionBridgeContractAddress();
      expect(unionBridgeAddressBeforeUpdate).to.equal(UNION_BRIDGE_ADDRESS);
      await assertNoAddressIsStored();

      // Act
      const txReceipt = await updateUnionAddress(newUnionBridgeContractAddress, changeUnionAddressAuthorizerAddress, assertSuccessfulResponseCode);

      // Assert
      const actualUnionAddress = await getUnionBridgeContractAddress();
      expect(actualUnionAddress).to.equal(newUnionBridgeContractAddress);
      await assertNoEventWasEmitted(txReceipt);
    });

    it('should increaseUnionBridgeLockingCap fail and return UNAUTHORIZED_CALLER when calling from an unauthorized address', async () => {
      // Arrange
      const unionLockingCapBeforeUpdate = await getUnionBridgeLockingCap();
      expect(unionLockingCapBeforeUpdate).to.equal(INITIAL_LOCKING_CAP);
      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_1, unauthorizedAddress, assertUnauthorizedResponseCode);
      // Assert
      const unionLockingCapAfter = await getUnionBridgeLockingCap();
      expect(unionLockingCapAfter).to.equal(unionLockingCapBeforeUpdate);
      await assertNoUnionLockingCapIsStored();
      await assertNoEventWasEmitted(txReceipt);
    });

    it('should increaseUnionBridgeLockingCap vote be successful when authorized', async () => {
      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_1, changeLockingCapAuthorizerAddress, assertSuccessfulResponseCode);
      // Assert
      await assertLockingCap(NEW_LOCKING_CAP_1);
      await assertLogUnionLockingCapIncreased(txReceipt, changeLockingCapAuthorizerAddress, INITIAL_LOCKING_CAP, NEW_LOCKING_CAP_1);
    });

    it("should increaseUnionBridgeLockingCap be successful when authorizer vote for new value", async () => {
      // Arrange
      const lockingCapBeforeUpdate = await getUnionBridgeLockingCap();
      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_2, changeLockingCapAuthorizerAddress, assertSuccessfulResponseCode);
      // Arrange
      await assertLockingCap(lockingCapBeforeUpdate);
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should increaseUnionBridgeLockingCap return INVALID_VALUE when trying to decrease the locking cap", async () => {
      // Arrange
      const lockingCapBeforeUpdate = await getUnionBridgeLockingCap();
      const smallerLockingCap = new BN(lockingCapBeforeUpdate).sub(new BN((1)));
      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(smallerLockingCap.toString(), changeLockingCapAuthorizerAddress, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.INVALID_VALUE);
      });
      // Assert
      await assertLockingCap(lockingCapBeforeUpdate);
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should requestUnionBridgeRbtc return UNAUTHORIZED_CALLER when caller is unauthorized", async () => {
      // Arrange
      await assertNoWeisTransferredToUnionBridgeIsStored();
      const unionBridgeBalanceBefore = await getUnionBridgeBalance();
      // Act
      const txReceipt = await requestUnionBridgeRbtcFromUnauthorizedCaller(AMOUNT_TO_REQUEST, assertUnauthorizedResponseCode);
      // Arrange
      await assertNoWeisTransferredToUnionBridgeIsStored();
      await assertUnionBridgeBalance(unionBridgeBalanceBefore);
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should requestUnionRbtc be successful when called from union bridge contract address", async () => {
      // Arrange
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();
      // Act
      const txReceipt =  await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, assertSuccessfulResponseCode);
      // Assert
      await assertLogUnionRbtcRequested(txReceipt, unionBridgeContractAddress, AMOUNT_TO_REQUEST);
      const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      await assertUnionBridgeBalance(expectedUnionBridgeBalance);
      await assertWeisTransferredToUnionBridgeBalance(expectedWeisTransferred);
    });

    it("should releaseUnionBridgeRbtc return UNAUTHORIZED_CALLER when caller is unauthorized", async () => {
      // Arrange
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();

      // Act
      const txReceipt = await releaseUnionBridgeRbtcFromUnauthorizedCaller(AMOUNT_TO_RELEASE, assertUnauthorizedResponseCode);
      // Assert
      await assertWeisTransferredToUnionBridgeBalance(weisTransferredBeforeRelease);
      await assertUnionBridgeBalance(unionBridgeBalanceBeforeRelease);
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should releaseUnionBridgeRbtc be successful when called from union bridge contract", async () => {
      // Arrange
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();
      // Act
      const txReceipt = await releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE, assertSuccessfulResponseCode);
      // Assert
      await assertLogUnionRbtcReleased(txReceipt, unionBridgeContractAddress, AMOUNT_TO_RELEASE);
      const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      await assertWeisTransferredToUnionBridgeBalance(expectedWeisTransferredAfter);
      await assertUnionBridgeBalance(expectedUnionBridgeBalanceAfter);
    });

    it("should setUnionBridgeTransferPermissions return UNAUTHORIZED_CALLER when caller is unauthorized", async () => {
      // Assert that no union transferred permissions are stored initially
      await assertNoUnionTransferredPermissionsIsStored();
      // Act
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED, unauthorizedAddress, assertUnauthorizedResponseCode);
      // Assert
      await assertNoUnionTransferredPermissionsIsStored();
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should setUnionBridgeTransferPermissions vote be successful when called from authorized caller", async () => {
      // Arrange
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED, changeTransferPermissionsAuthorizerAddress, assertSuccessfulResponseCode);
      // Assert transferred permissions remain unchanged
      await assertUnionTransferredPermissions(RELEASE_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED);
      await assertLogUnionTransferPermissionsSet(txReceipt, changeTransferPermissionsAuthorizerAddress, RELEASE_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED);
    });

    it("should requestUnionBridgeRbtc fail when request permission is disabled", async () => {
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();
      // Act
      const txReceipt =  await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.REQUEST_DISABLED);
      });
      // Assert
      await assertNoEventWasEmitted(txReceipt);
      // Assert that balances remain unchanged
      await assertWeisTransferredToUnionBridgeBalance(weisTransferredBeforeRequest);
      await assertUnionBridgeBalance(unionBridgeBalanceBeforeRequest);
    });

    it("should increaseUnionBridgeLockingCap vote be successful when transfer permissions are disabled", async () => {
      // Arrange
      const unionLockingCapBeforeUpdate = await getUnionBridgeLockingCap();
      const newLockingCap = new BN(unionLockingCapBeforeUpdate).mul(new BN(LOCKING_CAP_INCREMENTS_MULTIPLIER));
      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(newLockingCap.toString(), changeLockingCapAuthorizerAddress, assertSuccessfulResponseCode);
      // Assert
      await assertLockingCap(newLockingCap.toString());
      await assertLogUnionLockingCapIncreased(txReceipt, changeLockingCapAuthorizerAddress, unionLockingCapBeforeUpdate, newLockingCap.toString());
    });

    it("should setUnionBridgeContractAddressForTestnet be successful when transfer permissions are disabled", async () => {
      const actualUnionAddress = await getUnionBridgeContractAddress();
      // Act
      await deployAndFundUnionBridgeContract();
      const txReceipt = await updateUnionAddress(newUnionBridgeContractAddress, changeUnionAddressAuthorizerAddress, assertSuccessfulResponseCode);
      // Assert
      const newUnionAddress = await getUnionBridgeContractAddress();
      expect(newUnionAddress).to.equal(newUnionBridgeContractAddress);
      expect(actualUnionAddress).to.not.equal(newUnionBridgeContractAddress);
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should setUnionTransferPermissions vote be successful when voting to enable only request permission", async () => {
      // Act
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_DISABLED, changeTransferPermissionsAuthorizerAddress, assertSuccessfulResponseCode);
      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_DISABLED);
      await assertLogUnionTransferPermissionsSet(txReceipt, changeTransferPermissionsAuthorizerAddress, REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_DISABLED);
    });

    it("should requestUnionBridgeRbtc be successful when request permission is enabled", async () => {
      // Arrange
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();
      // Act
      const txReceipt = await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, assertSuccessfulResponseCode);
      // Assert
      const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      await assertUnionBridgeBalance(expectedUnionBridgeBalance);
      await assertWeisTransferredToUnionBridgeBalance(expectedWeisTransferred);
      await assertLogUnionRbtcRequested(txReceipt, unionBridgeContractAddress, AMOUNT_TO_REQUEST);
    });

    it("should releaseUnionBridgeRbtc fail when release permission is disabled", async () => {
      // Arrange
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();
      // Act
      const txReceipt = await releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.RELEASE_DISABLED);
      });
      // Assert
      await assertNoEventWasEmitted(txReceipt);
      // Assert that balances remain unchanged
      await assertWeisTransferredToUnionBridgeBalance(weisTransferredBeforeRelease);
      await assertUnionBridgeBalance(unionBridgeBalanceBeforeRelease);
    });

    it("should setUnionBridgeTransferPermissions vote be successful when voting to enable only release permission", async () => {
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_ENABLED, changeTransferPermissionsAuthorizerAddress, assertSuccessfulResponseCode);
      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_ENABLED);
      await assertLogUnionTransferPermissionsSet(txReceipt, changeTransferPermissionsAuthorizerAddress, REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_ENABLED);
    });

    it("should requestUnionBridgeRbtc fail when only release permission is enabled", async () => {
      // Arrange
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();
      // Act
      const txReceipt = await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.REQUEST_DISABLED);
      });
      // Assert
      await assertNoEventWasEmitted(txReceipt);
      // Assert that balances remain unchanged
      await assertWeisTransferredToUnionBridgeBalance(weisTransferredBeforeRequest);
      await assertUnionBridgeBalance(unionBridgeBalanceBeforeRequest);
    });

    it("should releaseUnionBridgeRbtc be successful when release permission is enabled", async () => {
      // Arrange
      const unionBridgeAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();
      // Act
      const txReceipt = await releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE, assertSuccessfulResponseCode);
      // Assert
      const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      await assertWeisTransferredToUnionBridgeBalance(expectedWeisTransferredAfter);
      await assertUnionBridgeBalance(expectedUnionBridgeBalanceAfter);
      await assertLogUnionRbtcReleased(txReceipt, unionBridgeAddress, AMOUNT_TO_RELEASE);
    });

    it("should setTransferPermissions vote be successful when voting to enable both request and release permissions", async () => {
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED, changeTransferPermissionsAuthorizerAddress, assertSuccessfulResponseCode);
      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED);
      await assertLogUnionTransferPermissionsSet(txReceipt, changeTransferPermissionsAuthorizerAddress, REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED);
    });

    it("should requestUnionBridgeRbtc fail when surpass locking cap", async () => {
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();
      const currentLockingCap = await getUnionBridgeLockingCap();
      const amountToRequestSurpassingLockingCap = new BN(currentLockingCap).add(new BN(1));
      // Act
      const txReceipt = await requestUnionBridgeRbtc(amountToRequestSurpassingLockingCap.toString(), (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.INVALID_VALUE);
      });
      // Assert
      await assertNoEventWasEmitted(txReceipt);
      // Assert that balances remain unchanged
      await assertWeisTransferredToUnionBridgeBalance(weisTransferredBeforeRequest);
      await assertUnionBridgeBalance(unionBridgeBalanceBeforeRequest);
    });

    it("should releaseUnionBridgeRbtc fail when weisTransferredBalance", async () => {
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();
      const amountToReleaseSurpassingBalance = new BN(weisTransferredBeforeRelease).add(new BN(AMOUNT_TO_RELEASE));
      // Add extra funds to simulate the union bridge sending more than the transferred amount
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      await rskUtils.sendFromCow(rskTxHelper, unionBridgeContractAddress, amountToReleaseSurpassingBalance.toString());
      const unionBridgeBalanceAfterFunding = await getUnionBridgeBalance();
      const expectedUnionBridgeBalanceAfterFunding = new BN(unionBridgeBalanceBeforeRelease).add(amountToReleaseSurpassingBalance);
      expect(unionBridgeBalanceAfterFunding.toString()).to.equal(expectedUnionBridgeBalanceAfterFunding.toString());

      // Act
      const txReceipt = await releaseUnionBridgeRbtc(amountToReleaseSurpassingBalance.toString(), (actualUnionResponseCode) => {
        expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.INVALID_VALUE);
      });
      // Assert that balances remain unchanged
      await assertWeisTransferredToUnionBridgeBalance(weisTransferredBeforeRelease);
      await assertUnionBridgeBalance(unionBridgeBalanceAfterFunding);
      // Assert transfer permission event was emitted setting both permissions to disabled
      await assertLogUnionTransferPermissionsSet(txReceipt, BRIDGE_ADDRESS, REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED);
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED);
    });

    it("should setUnionTransferPermissions vote be successful when voting to enable both permissions", async () => {
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED, changeTransferPermissionsAuthorizerAddress, assertSuccessfulResponseCode);
      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED);
      await assertLogUnionTransferPermissionsSet(txReceipt, changeTransferPermissionsAuthorizerAddress, REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED);
    });

    it("should requestUnionBridgeRbtc be successful after force pause", async () => {
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();
      // Act
      const txReceipt = await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, assertSuccessfulResponseCode);
      // Assert
      const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      await assertUnionBridgeBalance(expectedUnionBridgeBalance);
      await assertWeisTransferredToUnionBridgeBalance(expectedWeisTransferred);
      await assertLogUnionRbtcRequested(txReceipt, unionBridgeContractAddress, AMOUNT_TO_REQUEST);
    });

    it("should releaseUnionBridgeRbtc be successful after force pause", async () => {
      // Arrange
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridgeBalance();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();
      // Act
      const txReceipt = await releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE, assertSuccessfulResponseCode);
      // Assert
      const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      await assertWeisTransferredToUnionBridgeBalance(expectedWeisTransferredAfter);
      await assertUnionBridgeBalance(expectedUnionBridgeBalanceAfter);
      await assertLogUnionRbtcReleased(txReceipt, unionBridgeContractAddress, AMOUNT_TO_RELEASE);
    });
  });
}

const importAccounts = async (privateKeys) => {
  const importedAddresses = [];
  for (const privateKey of privateKeys) {
    const address = await rskTxHelper.importAccount(privateKey);
    importedAddresses.push(address);
  }
  return importedAddresses;
};

const createAndFundAccounts = async () => {
  const importedNotAuthorizedAddresses = await importAccounts([UNAUTHORIZED_1_PRIVATE_KEY]);
  unauthorizedAddress = importedNotAuthorizedAddresses[0];

  const unionAuthorizedAddresses = await importAccounts([
    CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
    ...CHANGE_LOCKING_CAP_AUTHORIZERS_PKS.slice(0, 1),
    ...CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PKS.slice(0, 1)
  ]);
  changeUnionAddressAuthorizerAddress = unionAuthorizedAddresses[0];
  changeLockingCapAuthorizerAddress = unionAuthorizedAddresses[1];
  changeTransferPermissionsAuthorizerAddress = unionAuthorizedAddresses[3];

  // Sending some funds to the not authorized addresses to pay for transaction fees while voting.
  // This is done to realistically test the union bridge methods, so it doesn't fail by something else like insufficient funds.
  await rskUtils.sendFromCow(rskTxHelper, unauthorizedAddress, btcToWeis(0.1));

  // Send some funds to the union authorizers to pay for transaction fees while voting.
  await rskUtils.sendFromCow(rskTxHelper, changeUnionAddressAuthorizerAddress, btcToWeis(0.1));
  await rskUtils.sendFromCow(rskTxHelper, changeLockingCapAuthorizerAddress, btcToWeis(0.1));
  await rskUtils.sendFromCow(rskTxHelper, changeTransferPermissionsAuthorizerAddress, btcToWeis(0.1));
}

const deployAndFundUnionBridgeContract = async () => {
  unionBridgeContractCreatorAddress = await rskUtils.getNewFundedRskAddress(rskTxHelper);
  unionBridgeContract = await deployUnionBridgeContract(rskTxHelper, unionBridgeContractCreatorAddress);
  newUnionBridgeContractAddress = unionBridgeContract._address;
};

const getUnionBridgeContractAddress = async () => {
  try {
    const result = await bridge.methods.getUnionBridgeContractAddress().call();
    return result;
  } catch (e) {
    console.log(e);
  }
};

const assertNoAddressIsStored = async () => {
  const unionBridgeAddressEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_CONTRACT_ADDRESS);
  expect(unionBridgeAddressEncoded).to.equal(NO_VALUE);
}

const assertNoUnionLockingCapIsStored = async () => {
  const unionLockingCapEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_LOCKING_CAP);
  expect(unionLockingCapEncoded).to.equal(NO_VALUE);
}

const updateUnionAddress = async (newUnionAddress, fromAddress, checkCallback) => {
  const method = bridge.methods.setUnionBridgeContractAddressForTestnet(newUnionAddress);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, fromAddress, checkCallback);
};

const assertSuccessfulResponseCode = actualUnionResponseCode => {
  expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.SUCCESS);
};

const assertUnauthorizedResponseCode = (actualUnionResponseCode) => {
  expect(actualUnionResponseCode).to.equal(UNION_RESPONSE_CODES.UNAUTHORIZED_CALLER);
}

const assertNoEventWasEmitted = async (txReceipt) => {
  const isEmpty = Object.keys(txReceipt.events).length === 0
  expect(isEmpty, "No event should have been emitted").to.be.true;
}

const getUnionBridgeLockingCap = async () => {
  return await bridge.methods.getUnionBridgeLockingCap().call();
};

const increaseUnionBridgeLockingCap = async (newLockingCap, fromAddress, checkCallback) => {
  const method = bridge.methods.increaseUnionBridgeLockingCap(newLockingCap);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, fromAddress, checkCallback);
};

const assertLockingCap = async (expectedLockingCap) => {
  const actualLockingCap = await getUnionBridgeLockingCap();
  expect(actualLockingCap).to.equal(expectedLockingCap);
  await assertStoredUnionLockingCap(expectedLockingCap);
}

const assertStoredUnionLockingCap = async (expectedLockingCap) => {
  const unionLockingCapEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_LOCKING_CAP);
  expect(unionLockingCapEncoded).to.not.equal(NO_VALUE);
  const unionLockingCapDecoded = getBridgeStorageValueDecodedHexString(unionLockingCapEncoded);
  const actualUnionLockingCap = new BN(removePrefix0x(unionLockingCapDecoded), 16);
  expect(actualUnionLockingCap.toString()).to.equal(expectedLockingCap.toString());
}

const assertLogUnionLockingCapIncreased = async (txReceipt, callerAddress, previousLockingCap, newLockingCap) => {
  const transaction = await bridgeTxParser.getBridgeTransactionByTxHash(txReceipt.transactionHash);
  const expectedEventName = UNION_BRIDGE_EVENTS.UNION_LOCKING_CAP_INCREASED.name;
  expect(transaction.events.length).to.equal(1);
  const foundEvent = transaction.events.find(event => event.name === expectedEventName);
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.exist;
  expect(foundEvent.arguments.caller.toLowerCase()).to.equal(callerAddress.toLowerCase());
  expect(foundEvent.arguments.previousLockingCap).to.equal(previousLockingCap);
  expect(foundEvent.arguments.newLockingCap).to.equal(newLockingCap);
};

const assertLogUnionTransferPermissionsSet = async (txReceipt, callerAddress, requestEnabled, releaseEnabled) => {
  const transaction = await bridgeTxParser.getBridgeTransactionByTxHash(txReceipt.transactionHash);
  const expectedEventName = UNION_BRIDGE_EVENTS.UNION_BRIDGE_TRANSFER_PERMISSIONS_UPDATED.name;
  expect(transaction.events.length).to.equal(1);
  const foundEvent = transaction.events.find(event => event.name === expectedEventName);
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.exist;
  expect(foundEvent.arguments.caller.toLowerCase()).to.equal(callerAddress.toLowerCase());
  expect(foundEvent.arguments.enablePowPegToUnionBridge).to.equal(requestEnabled);
  expect(foundEvent.arguments.enableUnionBridgeToPowPeg).to.equal(releaseEnabled);
};

const assertLogUnionRbtcRequested = async (txReceipt, callerAddress, amountRequested) => {
  const transaction = await bridgeTxParser.getBridgeTransactionByTxHash(txReceipt.transactionHash);
  const expectedEventName = UNION_BRIDGE_EVENTS.UNION_RBTC_REQUESTED.name;
  expect(transaction.events.length).to.equal(1);
  const foundEvent = transaction.events.find(event => event.name === expectedEventName);
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.exist;
  expect(foundEvent.arguments.requester.toLowerCase()).to.equal(callerAddress.toLowerCase());
  expect(foundEvent.arguments.amount).to.equal(amountRequested);
}

const assertLogUnionRbtcReleased = async (txReceipt, callerAddress, amountReleased) => {
  const transaction = await bridgeTxParser.getBridgeTransactionByTxHash(txReceipt.transactionHash);
  const expectedEventName = UNION_BRIDGE_EVENTS.UNION_RBTC_RELEASED.name;
  expect(transaction.events.length).to.equal(1);
  const foundEvent = transaction.events.find(event => event.name === expectedEventName);
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.exist;
  expect(foundEvent.arguments.receiver.toLowerCase()).to.equal(callerAddress.toLowerCase());
  expect(foundEvent.arguments.amount).to.equal(amountReleased);
}

const assertNoWeisTransferredToUnionBridgeIsStored = async () => {
  const weisTransferredEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.WEIS_TRANSFERRED_TO_UNION_BRIDGE);
  expect(weisTransferredEncoded).to.equal(NO_VALUE);
}

const assertUnionBridgeBalance = async (expectedBalance) => {
  const actualBalance = await getUnionBridgeBalance();
  expect(actualBalance.toString()).to.equal(expectedBalance.toString());
}

const getUnionBridgeBalance = async () => {
  const unionBridgeContractAddress = await getUnionBridgeContractAddress();
  const unionBridgeContractBalance = await rskTxHelper.getBalance(unionBridgeContractAddress);
  return unionBridgeContractBalance.toString();
}

const requestUnionBridgeRbtcFromUnauthorizedCaller = async (amountToRequest, checkCallback) => {
  // Call the method directly on the bridge contract
  const method = bridge.methods.requestUnionBridgeRbtc(amountToRequest);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, unionBridgeContractCreatorAddress, checkCallback);
};

const requestUnionBridgeRbtc = async (amountToRequest, checkCallback) => {
  const method = unionBridgeContract.methods.requestUnionBridgeRbtc(amountToRequest);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, unionBridgeContractCreatorAddress, checkCallback);
};

const releaseUnionBridgeRbtc = async (amountToRelease, checkCallback) => {
  const method = unionBridgeContract.methods.releaseUnionBridgeRbtc(amountToRelease);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, unionBridgeContractCreatorAddress, checkCallback);
}

const releaseUnionBridgeRbtcFromUnauthorizedCaller = async (amountToRelease, checkCallback) => {
  // Call the method directly on the bridge contract
  const method = bridge.methods.releaseUnionBridgeRbtc();
  return rskUtils.sendTxWithCheck(rskTxHelper, method, unionBridgeContractCreatorAddress, checkCallback);
};

const getWeisTransferredToUnionBridgeBalance = async () => {
  const weisTransferredEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.WEIS_TRANSFERRED_TO_UNION_BRIDGE);
  if (weisTransferredEncoded === NO_VALUE) {
    return "0";
  }
  const weisTransferredDecoded = getBridgeStorageValueDecodedHexString(weisTransferredEncoded);
  return new BN(removePrefix0x(weisTransferredDecoded), 16).toString();
}

const assertWeisTransferredToUnionBridgeBalance = async (expectedWeisTransferred) => {
  const actualWeisTransferred = await getWeisTransferredToUnionBridgeBalance();
  expect(actualWeisTransferred).to.equal(expectedWeisTransferred.toString());
}

const assertNoUnionTransferredPermissionsIsStored = async () => {
  const actualRequestPermissionEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_REQUEST_ENABLED);
  const actualReleasePermissionEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_RELEASE_ENABLED);
  expect(actualRequestPermissionEncoded).to.equal(NO_VALUE);
  expect(actualReleasePermissionEncoded).to.equal(NO_VALUE);
}

const setUnionTransferPermissions = async (requestEnabled, releaseEnabled, fromAddress, checkCallback) => {
  const method = bridge.methods.setUnionBridgeTransferPermissions(requestEnabled, releaseEnabled);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, fromAddress, checkCallback);
};

const assertUnionTransferredPermissions = async (expectedRequestPermission, expectedReleasePermission) => {
  const actualRequestPermissionEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_REQUEST_ENABLED);
  const actualReleasePermissionEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_RELEASE_ENABLED);
  expect(actualRequestPermissionEncoded).to.not.equal(NO_VALUE);
  expect(actualReleasePermissionEncoded).to.not.equal(NO_VALUE);
  const actualRequestPermission = getBridgeStorageValueDecodedHexString(actualRequestPermissionEncoded) === "0x01";
  const actualReleasePermission = getBridgeStorageValueDecodedHexString(actualReleasePermissionEncoded) === "0x01";
  expect(actualRequestPermission).to.equal(expectedRequestPermission);
  expect(actualReleasePermission).to.equal(expectedReleasePermission);
}

module.exports = {
  execute
};
