const chai = require("chai");
const expect = chai.expect;
chai.use(require("chai-as-promised"));
const BN = require("bn.js");

const rskUtils = require("../rsk-utils");

const { getBridge } = require("../bridge-provider");
const { getRskTransactionHelpers } = require("../rsk-tx-helper-provider");

const { btcToWeis, ethToWeis, weisToEth } = require("@rsksmart/btc-eth-unit-converter");

const {
  CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
  UNION_BRIDGE_AUTHORIZER_1_PK,
  UNION_BRIDGE_AUTHORIZER_2_PK,
  UNION_BRIDGE_AUTHORIZER_3_PK,
  UNION_BRIDGE_AUTHORIZER_DEPLOYER_PK,
  UNION_RESPONSE_CODES,
  INITIAL_UNION_BRIDGE_ADDRESS,
  UNION_BRIDGE_STORAGE_INDICES,
  INITIAL_UNION_LOCKING_CAP,
  UNION_LOCKING_CAP_INCREMENTS_MULTIPLIER,
  UNION_BRIDGE_EVENTS,
} = require("../constants/union-bridge-constants");

const { deployUnionBridgeContract, deployUnionBridgeAuthorizerContract } = require("../contractDeployer");
const { BRIDGE_ADDRESS } = require("../constants/bridge-constants");
const { getBridgeStorageValueDecodedHexString } = require("../utils");
const { decodeUnionLogs } = require("../union-bridge-utils");

const UNION_AUTHORIZER_VOTING_PERIOD_IN_BLOCKS = 360;

const NO_VALUE = "0x0";
const UNAUTHORIZED_1_PRIVATE_KEY = "bb7a53f495b863a007a3b1e28d2da2a5ec0343976a9be64e6fcfb97791b0112b";

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
let bridgeMethods;

let changeUnionAddressAuthorizerAddress;

let unionBridgeAuthorizerMember1Address;
let unionBridgeAuthorizerMember2Address;
let unionBridgeAuthorizerMember3Address;

let unionBridgeAuthorizerAddress;
let unionBridgeAuthorizerContract;
let unionBridgeAuthorizerContractAddress;

let unauthorizedAddress;

let unionBridgeContractCreatorAddress;
let unionBridgeContract;
let unionBridgeContractAddress;

let unionAndBridgeAbis;

const execute = (description) => {
  describe(description, () => {
    before(async () => {
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      rskClient = rskTxHelper.getClient();
      bridge = await getBridge(rskClient);
      bridgeMethods = bridge.methods;

      await createAndFundAccounts();
      await deployAndFundUnionBridgeContract();
      await deployAndInitUnionAuthorizerContract();

      unionAndBridgeAbis = [unionBridgeAuthorizerContract.options.jsonInterface, bridge.options.jsonInterface];
    });

    it("should setUnionBridgeContractAddressForTestnet change union address", async () => {
      // Arrange
      const unionBridgeAddressBeforeUpdate = await getUnionBridgeContractAddress();
      expect(unionBridgeAddressBeforeUpdate).to.equal(INITIAL_UNION_BRIDGE_ADDRESS);
      await assertNoUnionAddressIsStored();

      // Act
      const txReceipt = await setUnionBridgeContractAddressForTestnet(
        unionBridgeContractAddress,
        changeUnionAddressAuthorizerAddress,
        assertSuccessfulResponseCode
      );

      // Assert
      const currentUnionBridgeContractAddress = await getUnionBridgeContractAddress();
      expect(currentUnionBridgeContractAddress).to.equal(unionBridgeContractAddress);
      expect(unionBridgeAddressBeforeUpdate).to.not.equal(unionBridgeContractAddress);
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should increaseUnionBridgeLockingCap fail when calling from an unauthorized address", async () => {
      // Arrange
      const unionLockingCapBeforeUpdate = await getUnionBridgeLockingCap();
      expect(unionLockingCapBeforeUpdate).to.equal(INITIAL_UNION_LOCKING_CAP);

      // Act & Assert
      await assertContractCallFails(bridgeMethods.increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_1), {
        from: unauthorizedAddress,
      });
    });

    it("should increaseUnionBridgeLockingCap be successful when caller is authorized", async () => {
      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_1);

      // Assert
      await assertLockingCap(NEW_LOCKING_CAP_1);
      await assertLogUnionLockingCapIncreased(
        txReceipt.transactionHash,
        unionBridgeAuthorizerContractAddress,
        INITIAL_UNION_LOCKING_CAP,
        NEW_LOCKING_CAP_1
      );
    });

    it("should increaseUnionBridgeLockingCap be successful when vote again for another value", async () => {
      // Arrange
      const lockingCapBeforeUpdate = await getUnionBridgeLockingCap();
      await assertLockingCap(lockingCapBeforeUpdate);

      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_2);

      // Arrange
      await assertLockingCap(NEW_LOCKING_CAP_2);
      await assertLogUnionLockingCapIncreased(
        txReceipt.transactionHash,
        unionBridgeAuthorizerContractAddress,
        NEW_LOCKING_CAP_1,
        NEW_LOCKING_CAP_2
      );
    });

    it("should increaseUnionBridgeLockingCap fail when trying to decrease the locking cap", async () => {
      // Arrange
      const lockingCapBeforeUpdate = await getUnionBridgeLockingCap();
      const smallerLockingCap = new BN(lockingCapBeforeUpdate).sub(new BN(1));

      // Act & Assert
      await voteToIncreaseUnionBridgeLockingCapExpectingRevert(smallerLockingCap.toString());
      await assertLockingCap(lockingCapBeforeUpdate);
    });

    it("should requestUnionBridgeRbtc return UNAUTHORIZED_CALLER when caller is unauthorized", async () => {
      // Arrange
      await assertNoWeisTransferredToUnionBridgeIsStored();
      const unionBridgeBalanceBefore = await getUnionBridgeBalance();

      // Act
      const txReceipt = await requestUnionBridgeRbtcFromUnauthorizedCaller(
        AMOUNT_TO_REQUEST,
        assertUnauthorizedResponseCode
      );

      // Arrange
      await assertNoWeisTransferredToUnionBridgeIsStored();
      await assertUnionBridgeBalance(unionBridgeBalanceBefore);
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should requestUnionBridgeRbtc be successful when caller is the union contract address", async () => {
      // Arrange
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();

      // Act
      const txReceipt = await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, assertSuccessfulResponseCode);

      // Assert
      await assertLogUnionRbtcRequested(txReceipt, unionBridgeContractAddress, AMOUNT_TO_REQUEST);
      const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      await assertWeisTransferredAndUnionBridgeContractBalance(expectedWeisTransferred, expectedUnionBridgeBalance);
    });

    it("should releaseUnionBridgeRbtc return UNAUTHORIZED_CALLER when caller is unauthorized", async () => {
      // Arrange
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();

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
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should releaseUnionBridgeRbtc be successful when caller is the union contract address", async () => {
      // Arrange
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();

      // Act
      const txReceipt = await releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE, assertSuccessfulResponseCode);

      // Assert
      await assertLogUnionRbtcReleased(txReceipt, AMOUNT_TO_RELEASE);
      const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      await assertWeisTransferredAndUnionBridgeContractBalance(
        expectedWeisTransferredAfter,
        expectedUnionBridgeBalanceAfter
      );
    });

    it("should setUnionBridgeTransferPermissions return UNAUTHORIZED_CALLER when caller is unauthorized", async () => {
      // Assert that no union transferred permissions are stored initially
      await assertNoUnionTransferredPermissionsIsStored();

      // Act & Assert
      await assertContractCallFails(
        bridgeMethods.setUnionBridgeTransferPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED),
        {
          from: unauthorizedAddress,
        }
      );
    });

    it("should setUnionBridgeTransferPermissions vote be successful when caller is authorized", async () => {
      // Act
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED);

      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED);
      await assertLogUnionTransferPermissionsSet(
        txReceipt.transactionHash,
        unionBridgeAuthorizerContractAddress,
        REQUEST_PERMISSION_DISABLED,
        RELEASE_PERMISSION_DISABLED
      );
    });

    it("should requestUnionBridgeRbtc fail when request permission is disabled", async () => {
      // Arrange
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();

      // Act
      const txReceipt = await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, assertRequestDisabledResponseCode);

      // Assert
      await assertNoEventWasEmitted(txReceipt);
      await assertWeisTransferredAndUnionBridgeContractBalance(
        weisTransferredBeforeRequest,
        unionBridgeBalanceBeforeRequest
      );
    });

    it("should increaseUnionBridgeLockingCap vote be successful when transfer permissions are disabled", async () => {
      // Arrange
      const unionLockingCapBeforeUpdate = await getUnionBridgeLockingCap();
      const newLockingCap = new BN(unionLockingCapBeforeUpdate).mul(new BN(UNION_LOCKING_CAP_INCREMENTS_MULTIPLIER));

      // Act
      const txReceipt = await increaseUnionBridgeLockingCap(newLockingCap.toString());

      // Assert
      await assertLockingCap(newLockingCap.toString());
      await assertLogUnionLockingCapIncreased(
        txReceipt.transactionHash,
        unionBridgeAuthorizerContractAddress,
        unionLockingCapBeforeUpdate,
        newLockingCap.toString()
      );
    });

    it("should setUnionBridgeContractAddressForTestnet be successful when transfer permissions are disabled", async () => {
      // Arrange
      const unionAddressBeforeUpdate = await getUnionBridgeContractAddress();
      await deployAndFundUnionBridgeContract();

      // Act
      const txReceipt = await setUnionBridgeContractAddressForTestnet(
        unionBridgeContractAddress,
        changeUnionAddressAuthorizerAddress,
        assertSuccessfulResponseCode
      );

      // Assert
      const newUnionAddress = await getUnionBridgeContractAddress();
      expect(newUnionAddress).to.equal(unionBridgeContractAddress);
      expect(unionAddressBeforeUpdate).to.not.equal(unionBridgeContractAddress);
      await assertNoEventWasEmitted(txReceipt);
    });

    it("should setUnionTransferPermissions vote be successful when voting to enable only request permission", async () => {
      // Act
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_DISABLED);

      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_DISABLED);
      await assertLogUnionTransferPermissionsSet(
        txReceipt.transactionHash,
        unionBridgeAuthorizerContractAddress,
        REQUEST_PERMISSION_ENABLED,
        RELEASE_PERMISSION_DISABLED
      );
    });

    it("should requestUnionBridgeRbtc be successful when request permission is enabled", async () => {
      // Arrange
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();

      // Act
      const txReceipt = await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, assertSuccessfulResponseCode);

      // Assert
      const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      await assertWeisTransferredAndUnionBridgeContractBalance(expectedWeisTransferred, expectedUnionBridgeBalance);
      await assertLogUnionRbtcRequested(txReceipt, unionBridgeContractAddress, AMOUNT_TO_REQUEST);
    });

    it("should releaseUnionBridgeRbtc fail when release permission is disabled", async () => {
      // Arrange
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();

      // Act
      const txReceipt = await releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE, assertReleaseDisabledResponseCode);

      // Assert
      await assertNoEventWasEmitted(txReceipt);
      await assertWeisTransferredAndUnionBridgeContractBalance(
        weisTransferredBeforeRelease,
        unionBridgeBalanceBeforeRelease
      );
    });

    it("should setUnionBridgeTransferPermissions vote be successful when voting to enable only release permission", async () => {
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_ENABLED);
      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_ENABLED);
      await assertLogUnionTransferPermissionsSet(
        txReceipt.transactionHash,
        unionBridgeAuthorizerContractAddress,
        REQUEST_PERMISSION_DISABLED,
        RELEASE_PERMISSION_ENABLED
      );
    });

    it("should requestUnionBridgeRbtc fail when only release permission is enabled", async () => {
      // Arrange
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();

      // Act
      const txReceipt = await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, assertRequestDisabledResponseCode);

      // Assert
      await assertNoEventWasEmitted(txReceipt);
      await assertWeisTransferredAndUnionBridgeContractBalance(
        weisTransferredBeforeRequest,
        unionBridgeBalanceBeforeRequest
      );
    });

    it("should releaseUnionBridgeRbtc be successful when release permission is enabled", async () => {
      // Arrange
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();
      // Act
      const txReceipt = await releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE, assertSuccessfulResponseCode);
      // Assert
      const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      await assertWeisTransferredAndUnionBridgeContractBalance(
        expectedWeisTransferredAfter,
        expectedUnionBridgeBalanceAfter
      );
      await assertLogUnionRbtcReleased(txReceipt, AMOUNT_TO_RELEASE);
    });

    it("should setTransferPermissions vote be successful when voting to enable both request and release permissions", async () => {
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED);

      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED);
      await assertLogUnionTransferPermissionsSet(
        txReceipt.transactionHash,
        unionBridgeAuthorizerContractAddress,
        REQUEST_PERMISSION_ENABLED,
        RELEASE_PERMISSION_ENABLED
      );
    });

    it("should requestUnionBridgeRbtc fail when surpass locking cap", async () => {
      // Arrange
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();
      const currentLockingCap = await getUnionBridgeLockingCap();
      const amountToRequestSurpassingLockingCap = new BN(currentLockingCap).add(new BN(1));

      // Act
      const txReceipt = await requestUnionBridgeRbtc(
        amountToRequestSurpassingLockingCap.toString(),
        assertInvalidValueResponseCode
      );

      // Assert
      await assertNoEventWasEmitted(txReceipt);
      await assertWeisTransferredAndUnionBridgeContractBalance(
        weisTransferredBeforeRequest,
        unionBridgeBalanceBeforeRequest
      );
    });

    it("should releaseUnionBridgeRbtc fail when surpass weisTransferredBalance", async () => {
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();
      const amountToReleaseSurpassingBalance = new BN(weisTransferredBeforeRelease).add(new BN(AMOUNT_TO_RELEASE));
      // Add extra funds to simulate the union bridge sending more than the transferred amount
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      await rskUtils.sendFromCow(rskTxHelper, unionBridgeContractAddress, amountToReleaseSurpassingBalance.toString());
      const unionBridgeBalanceAfterFunding = await getUnionBridgeBalance();
      const expectedUnionBridgeBalanceAfterFunding = new BN(unionBridgeBalanceBeforeRelease).add(
        amountToReleaseSurpassingBalance
      );
      expect(unionBridgeBalanceAfterFunding.toString()).to.equal(expectedUnionBridgeBalanceAfterFunding.toString());

      // Act
      const txReceipt = await releaseUnionBridgeRbtc(
        amountToReleaseSurpassingBalance.toString(),
        assertInvalidValueResponseCode
      );
      await assertWeisTransferredAndUnionBridgeContractBalance(
        weisTransferredBeforeRelease,
        unionBridgeBalanceAfterFunding
      );
      // Assert transfer permission event was emitted setting both permissions to disabled
      await assertLogUnionTransferPermissionsSet(
        txReceipt.transactionHash,
        BRIDGE_ADDRESS,
        REQUEST_PERMISSION_DISABLED,
        RELEASE_PERMISSION_DISABLED
      );
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_DISABLED, RELEASE_PERMISSION_DISABLED);
    });

    it("should setUnionTransferPermissions vote be successful when voting to enable both permissions after forced pause", async () => {
      // Act
      const txReceipt = await setUnionTransferPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED);

      // Assert
      await assertUnionTransferredPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED);
      await assertLogUnionTransferPermissionsSet(
        txReceipt.transactionHash,
        unionBridgeAuthorizerContractAddress,
        REQUEST_PERMISSION_ENABLED,
        RELEASE_PERMISSION_ENABLED
      );
    });

    it("should requestUnionBridgeRbtc be successful after force pause", async () => {
      // Arrange
      const unionBridgeContractAddress = await getUnionBridgeContractAddress();
      const weisTransferredBeforeRequest = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRequest = await getUnionBridgeBalance();

      // Act
      const txReceipt = await requestUnionBridgeRbtc(AMOUNT_TO_REQUEST, assertSuccessfulResponseCode);

      // Assert
      const expectedWeisTransferred = new BN(weisTransferredBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      const expectedUnionBridgeBalance = new BN(unionBridgeBalanceBeforeRequest).add(new BN(AMOUNT_TO_REQUEST));
      await assertWeisTransferredAndUnionBridgeContractBalance(expectedWeisTransferred, expectedUnionBridgeBalance);
      await assertLogUnionRbtcRequested(txReceipt, unionBridgeContractAddress, AMOUNT_TO_REQUEST);
    });

    it("should releaseUnionBridgeRbtc be successful after force pause", async () => {
      // Arrange
      const weisTransferredBeforeRelease = await getWeisTransferredToUnionBridge();
      const unionBridgeBalanceBeforeRelease = await getUnionBridgeBalance();

      // Act
      const txReceipt = await releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE, assertSuccessfulResponseCode);

      // Assert
      const expectedWeisTransferredAfter = new BN(weisTransferredBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      const expectedUnionBridgeBalanceAfter = new BN(unionBridgeBalanceBeforeRelease).sub(new BN(AMOUNT_TO_RELEASE));
      await assertWeisTransferredAndUnionBridgeContractBalance(
        expectedWeisTransferredAfter,
        expectedUnionBridgeBalanceAfter
      );
      await assertLogUnionRbtcReleased(txReceipt, AMOUNT_TO_RELEASE);
    });
  });
};

const createAndFundAccounts = async () => {
  const importedNotAuthorizedAddresses = await rskUtils.importAccounts(rskTxHelper, [UNAUTHORIZED_1_PRIVATE_KEY]);
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
  unionBridgeAuthorizerAddress = unionAuthorizedAddresses[4];

  // Sending some funds to the not authorized addresses to pay for transaction fees while voting.
  const fundingAmount = btcToWeis(0.1);
  await rskUtils.sendFromCow(rskTxHelper, unauthorizedAddress, fundingAmount);

  // Send some funds to the union authorizers to pay for transaction fees while voting.
  await rskUtils.sendFromCow(rskTxHelper, changeUnionAddressAuthorizerAddress, fundingAmount);
  await rskUtils.sendFromCow(rskTxHelper, unionBridgeAuthorizerMember1Address, fundingAmount);
  await rskUtils.sendFromCow(rskTxHelper, unionBridgeAuthorizerMember2Address, fundingAmount);
  await rskUtils.sendFromCow(rskTxHelper, unionBridgeAuthorizerMember3Address, fundingAmount);
  await rskUtils.sendFromCow(rskTxHelper, unionBridgeAuthorizerAddress, fundingAmount);
};

const deployAndFundUnionBridgeContract = async () => {
  unionBridgeContractCreatorAddress = await rskUtils.getNewFundedRskAddress(rskTxHelper);
  unionBridgeContract = await deployUnionBridgeContract(rskTxHelper, unionBridgeContractCreatorAddress);
  unionBridgeContractAddress = unionBridgeContract._address;
};

const deployAndInitUnionAuthorizerContract = async () => {
  const multisigMembers = [
    unionBridgeAuthorizerMember1Address,
    unionBridgeAuthorizerMember2Address,
    unionBridgeAuthorizerMember3Address,
  ];

  unionBridgeAuthorizerContract = await deployUnionBridgeAuthorizerContract(rskTxHelper, unionBridgeAuthorizerAddress);
  unionBridgeAuthorizerContractAddress = unionBridgeAuthorizerContract._address;

  const multisigInitMethod = unionBridgeAuthorizerContract.methods.init(
    multisigMembers,
    UNION_AUTHORIZER_VOTING_PERIOD_IN_BLOCKS
  );
  const txReceipt = await rskUtils.sendTransaction(
    rskTxHelper,
    multisigInitMethod,
    unionBridgeAuthorizerAddress,
    0,
    300000
  );
  assertUnionAuthorizerInitializedEventWasEmitted(txReceipt);
};

const assertUnionAuthorizerInitializedEventWasEmitted = (txReceipt) => {
  const expectedEventName = "Initialized";
  const foundEvent = txReceipt.events[expectedEventName];
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be.undefined;
  expect(foundEvent.returnValues.votingPeriodInBlocks).to.equal(UNION_AUTHORIZER_VOTING_PERIOD_IN_BLOCKS.toString());
};

const getUnionBridgeContractAddress = async () => {
  return await bridgeMethods.getUnionBridgeContractAddress().call();
};

const assertNoUnionAddressIsStored = async () => {
  const unionBridgeAddressEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_CONTRACT_ADDRESS
  );
  expect(unionBridgeAddressEncoded).to.equal(NO_VALUE);
};

const setUnionBridgeContractAddressForTestnet = async (newUnionAddress, fromAddress, checkCallback) => {
  const updateUnionAddressMethod = bridgeMethods.setUnionBridgeContractAddressForTestnet(newUnionAddress);
  return rskUtils.sendTxWithCheck(rskTxHelper, updateUnionAddressMethod, fromAddress, checkCallback);
};

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

const getUnionBridgeLockingCap = async () => {
  return await bridgeMethods.getUnionBridgeLockingCap().call();
};

const increaseUnionBridgeLockingCap = async (newLockingCap) => {
  // First vote from member 1
  const txReceiptFirstVote = await voteToIncreaseUnionBridgeLockingCap(
    newLockingCap,
    unionBridgeAuthorizerMember1Address
  );
  assertIncreaseUnionLockingCapVotedEventWasEmitted(
    newLockingCap,
    unionBridgeAuthorizerMember1Address,
    txReceiptFirstVote
  );

  // Second vote from member 2 (reaches the threshold and executes)
  const txReceiptSecondVote = await voteToIncreaseUnionBridgeLockingCap(
    newLockingCap,
    unionBridgeAuthorizerMember2Address
  );
  assertIncreaseUnionLockingCapVotedEventWasEmitted(
    newLockingCap,
    unionBridgeAuthorizerMember2Address,
    txReceiptSecondVote
  );

  assertIncreaseUnionLockingCapExecutedEventWasEmitted(newLockingCap, txReceiptSecondVote);
  return txReceiptSecondVote;
};

const voteToIncreaseUnionBridgeLockingCap = async (newLockingCap, authorizedMember) => {
  const increaseLockingCapVote = unionBridgeAuthorizerContract.methods.voteToIncreaseUnionLockingCap(newLockingCap);
  return await rskUtils.sendTransaction(rskTxHelper, increaseLockingCapVote, authorizedMember, 0, 300000);
};

const voteToIncreaseUnionBridgeLockingCapExpectingRevert = async (newLockingCap) => {
  // First vote from member 1 should succeed
  const txReceiptFirstVote = await voteToIncreaseUnionBridgeLockingCap(
    newLockingCap,
    unionBridgeAuthorizerMember1Address
  );
  assertIncreaseUnionLockingCapVotedEventWasEmitted(
    newLockingCap,
    unionBridgeAuthorizerMember1Address,
    txReceiptFirstVote
  );

  // Second vote from member 2 should revert when the bridge call fails
  await assertContractCallFails(unionBridgeAuthorizerContract.methods.voteToIncreaseUnionLockingCap(newLockingCap), {
    from: unionBridgeAuthorizerMember2Address,
  });
  // Mine blocks to make voting expire
  await rskUtils.mineAndSync(rskTxHelpers, UNION_AUTHORIZER_VOTING_PERIOD_IN_BLOCKS);
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

const assertLockingCap = async (expectedLockingCap) => {
  const actualLockingCap = await getUnionBridgeLockingCap();
  expect(actualLockingCap).to.equal(expectedLockingCap);
  await assertStoredUnionLockingCap(expectedLockingCap);
};

const assertStoredUnionLockingCap = async (expectedLockingCap) => {
  const unionLockingCapEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.UNION_BRIDGE_LOCKING_CAP
  );
  expect(unionLockingCapEncoded).to.not.equal(NO_VALUE);
  const unionLockingCapDecoded = getBridgeStorageValueDecodedHexString(unionLockingCapEncoded, false);
  const actualUnionLockingCap = new BN(unionLockingCapDecoded, 16);
  expect(actualUnionLockingCap.toString()).to.equal(expectedLockingCap.toString());
};

const assertLogUnionLockingCapIncreased = async (txHash, callerAddress, previousLockingCap, newLockingCap) => {
  // Fetch the transaction receipt to get all the logs(including the ones from internal txs)
  const txReceipt = await rskTxHelper.getTxReceipt(txHash);
  const unionEvents = decodeUnionLogs(rskClient, txReceipt, unionAndBridgeAbis);
  const expectedEventName = UNION_BRIDGE_EVENTS.UNION_LOCKING_CAP_INCREASED.name;
  const foundEvent = unionEvents.find((event) => event.name === expectedEventName);
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be.undefined;

  const eventArguments = foundEvent.args;
  expect(eventArguments.caller.toLowerCase()).to.equal(callerAddress.toLowerCase());
  expect(eventArguments.previousLockingCap).to.equal(previousLockingCap);
  expect(eventArguments.newLockingCap).to.equal(newLockingCap);
};

const assertLogUnionTransferPermissionsSet = async (txHash, callerAddress, requestEnabled, releaseEnabled) => {
  // Fetch the transaction receipt to get all the logs (including the ones from internal txs)
  const txReceipt = await rskTxHelper.getTxReceipt(txHash);
  const unionEvents = decodeUnionLogs(rskClient, txReceipt, unionAndBridgeAbis);
  const expectedEventName = UNION_BRIDGE_EVENTS.UNION_BRIDGE_TRANSFER_PERMISSIONS_UPDATED.name;
  const foundEvent = unionEvents.find((event) => event.name === expectedEventName);
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be.undefined;

  const eventArguments = foundEvent.args;
  expect(eventArguments.caller.toLowerCase()).to.equal(callerAddress.toLowerCase());
  expect(eventArguments.enablePowPegToUnionBridge).to.equal(requestEnabled);
  expect(eventArguments.enableUnionBridgeToPowPeg).to.equal(releaseEnabled);
};

const assertLogUnionRbtcRequested = async (txReceipt, callerAddress, amountRequested) => {
  if (txReceipt.from !== BRIDGE_ADDRESS) {
    return;
  }
  const expectedEventName = UNION_BRIDGE_EVENTS.UNION_RBTC_REQUESTED.name;
  const foundEvent = txReceipt.events[expectedEventName];
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be.undefined;

  const eventArguments = foundEvent.returnValues;
  expect(eventArguments.requester.toLowerCase()).to.equal(callerAddress.toLowerCase());
  expect(eventArguments.amount).to.equal(amountRequested);
};

const assertLogUnionRbtcReleased = async (txReceipt, amountReleased) => {
  if (txReceipt.from !== BRIDGE_ADDRESS) {
    return;
  }
  const expectedEventName = UNION_BRIDGE_EVENTS.UNION_RBTC_RELEASED.name;
  const foundEvent = txReceipt.events[expectedEventName];
  expect(foundEvent, `Expected to find event with name "${expectedEventName}"`).to.not.be.undefined;

  const eventArguments = foundEvent.returnValues;
  expect(eventArguments.receiver.toLowerCase()).to.equal(unionBridgeContractAddress.toLowerCase());
  expect(eventArguments.amount).to.equal(amountReleased);
};

const assertNoWeisTransferredToUnionBridgeIsStored = async () => {
  const weisTransferredEncoded = await rskClient.rsk.getStorageBytesAt(
    BRIDGE_ADDRESS,
    UNION_BRIDGE_STORAGE_INDICES.WEIS_TRANSFERRED_TO_UNION_BRIDGE
  );
  expect(weisTransferredEncoded).to.equal(NO_VALUE);
};

const assertUnionBridgeBalance = async (expectedBalance) => {
  const actualBalance = await getUnionBridgeBalance();
  expect(actualBalance.toString()).to.equal(expectedBalance.toString());
};

const getUnionBridgeBalance = async () => {
  const unionBridgeContractAddress = await getUnionBridgeContractAddress();
  const unionBridgeContractBalance = await rskTxHelper.getBalance(unionBridgeContractAddress);
  return unionBridgeContractBalance.toString();
};

const requestUnionBridgeRbtcFromUnauthorizedCaller = async (amountToRequest, checkCallback) => {
  // Call the method directly on the bridge contract
  const method = bridgeMethods.requestUnionBridgeRbtc(amountToRequest);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, unionBridgeContractCreatorAddress, checkCallback);
};

const requestUnionBridgeRbtc = async (amountToRequest, checkCallback) => {
  const method = unionBridgeContract.methods.requestUnionBridgeRbtc(amountToRequest);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, unionBridgeContractCreatorAddress, checkCallback);
};

const releaseUnionBridgeRbtc = async (amountToRelease, checkCallback) => {
  const method = unionBridgeContract.methods.releaseUnionBridgeRbtc(amountToRelease);
  return rskUtils.sendTxWithCheck(rskTxHelper, method, unionBridgeContractCreatorAddress, checkCallback);
};

const releaseUnionBridgeRbtcFromUnauthorizedCaller = async (amountToRelease, checkCallback) => {
  // Call the method directly on the bridge contract
  const method = bridgeMethods.releaseUnionBridgeRbtc();
  const unionResponseCode = await method.call({
    from: unauthorizedAddress,
    value: amountToRelease,
  });
  await checkCallback(unionResponseCode);
  return rskUtils.sendTransaction(rskTxHelper, method, unauthorizedAddress, amountToRelease);
};

const getWeisTransferredToUnionBridge = async () => {
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

const assertWeisTransferredAndUnionBridgeContractBalance = async (
  expectedWeisTransferred,
  expectedUnionBridgeBalance
) => {
  await assertWeisTransferredToUnionBridge(expectedWeisTransferred);
  await assertUnionBridgeBalance(expectedUnionBridgeBalance);
};

const assertWeisTransferredToUnionBridge = async (expectedWeisTransferred) => {
  const actualWeisTransferred = await getWeisTransferredToUnionBridge();
  expect(actualWeisTransferred).to.equal(expectedWeisTransferred.toString());
};

const assertNoUnionTransferredPermissionsIsStored = async () => {
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

const setUnionTransferPermissions = async (requestEnabled, releaseEnabled) => {
  // First vote from member 1
  const txReceiptFirstVote = await voteToSetUnionTransferPermissions(
    requestEnabled,
    releaseEnabled,
    unionBridgeAuthorizerMember1Address
  );
  assertUnionTransferPermissionsVotedEventWasEmitted(
    requestEnabled,
    releaseEnabled,
    unionBridgeAuthorizerMember1Address,
    txReceiptFirstVote
  );

  // Second vote from member 2 (reaches the threshold and executes)
  const txReceiptSecondVote = await voteToSetUnionTransferPermissions(
    requestEnabled,
    releaseEnabled,
    unionBridgeAuthorizerMember2Address
  );
  assertUnionTransferPermissionsVotedEventWasEmitted(
    requestEnabled,
    releaseEnabled,
    unionBridgeAuthorizerMember2Address,
    txReceiptSecondVote
  );

  assertUnionTransferPermissionsExecutedEventWasEmitted(requestEnabled, releaseEnabled, txReceiptSecondVote);
  return txReceiptSecondVote;
};

const voteToSetUnionTransferPermissions = async (requestEnabled, releaseEnabled, authorizedMember) => {
  const setUnionTransferPermissionsVote = unionBridgeAuthorizerContract.methods.voteToSetUnionTransferPermissions(
    requestEnabled,
    releaseEnabled
  );
  return await rskUtils.sendTransaction(rskTxHelper, setUnionTransferPermissionsVote, authorizedMember, 0, 300000);
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

const assertUnionTransferredPermissions = async (expectedRequestPermission, expectedReleasePermission) => {
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
  const actualRequestPermission = getBridgeStorageValueDecodedHexString(actualRequestPermissionEncoded, false) === "01";
  const actualReleasePermission = getBridgeStorageValueDecodedHexString(actualReleasePermissionEncoded, false) === "01";
  expect(actualRequestPermission).to.equal(expectedRequestPermission);
  expect(actualReleasePermission).to.equal(expectedReleasePermission);
};

const assertContractCallFails = async (methodCall, options) => {
  await expect(methodCall.call(options)).to.be.rejected;
};

module.exports = {
  execute,
};
