const rskUtils = require('../lib/rsk-utils');
const chai = require('chai');
const expect = chai.expect;

chai.use(require('chai-as-promised'));

const {CHANGE_LOCKING_CAP_AUTHORIZERS_PKS, CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
  CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PKS,
  INITIAL_LOCKING_CAP,
  LOCKING_CAP_INCREMENTS_MULTIPLIER
} = require("../lib/constants/union-bridge-constants");
const {getBridge} = require("../lib/bridge-provider");
const {btcToWeis, ethToWeis, weisToEth} = require("@rsksmart/btc-eth-unit-converter");
const {deployUnionBridgeContract} = require("../lib/contractDeployer");
const {getNewFundedRskAddress } = require("../lib/rsk-utils");

const UNAUTHORIZED_1_PRIVATE_KEY = 'bb7a53f495b863a007a3b1e28d2da2a5ec0343976a9be64e6fcfb97791b0112b';

const INITIAL_MAX_LOCKING_CAP_INCREMENT = ethToWeis(Number(weisToEth(INITIAL_LOCKING_CAP)) * LOCKING_CAP_INCREMENTS_MULTIPLIER);
const NEW_LOCKING_CAP_1 = ethToWeis(weisToEth(INITIAL_MAX_LOCKING_CAP_INCREMENT) - 20);

const AMOUNT_TO_REQUEST = btcToWeis(2);
const AMOUNT_TO_RELEASE = btcToWeis(1);

const REQUEST_PERMISSION_ENABLED = true;
const RELEASE_PERMISSION_ENABLED = true;

let rskTxHelpers;
let rskTxHelper;
let bridge;

let changeUnionAddressAuthorizerAddress;
let changeLockingCapAuthorizer1Address;
let changeLockingCapAuthorizer2Address;
let changeTransferPermissionsAuthorizer1Address;
let changeTransferPermissionsAuthorizer2Address;

let unauthorizedAddress;

let unionBridgeContractCreatorAddress;
let unionBridgeContract;
let newUnionBridgeContractAddress;

const execute = (description) => {
  describe(description, () => {
    before(async () => {
      // Initialize helpers and bridge
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      bridge = await getBridge(rskTxHelper.getClient());

      // Create accounts for the authorizers
      await createAndFundAccounts(rskTxHelper);

      unionBridgeContractCreatorAddress = await getNewFundedRskAddress(rskTxHelper);
      unionBridgeContract = await deployUnionBridgeContract(rskTxHelper, unionBridgeContractCreatorAddress);
      newUnionBridgeContractAddress = unionBridgeContract._address;
    });

    it('should fail when call getUnionBridgeContractAddress', async () => {
      return assertContractCallFails(bridge.methods.getUnionBridgeContractAddress());
    });

    it('should fail when call setUnionBridgeContractAddressForTestnet', async () => {
      return assertContractCallFails(bridge.methods.setUnionBridgeContractAddressForTestnet(newUnionBridgeContractAddress), {
        from: changeUnionAddressAuthorizerAddress
      });
    });

    it('should fail when call increaseUnionBridgeLockingCap', async () => {
      return assertContractCallFails(bridge.methods.increaseUnionBridgeLockingCap(NEW_LOCKING_CAP_1), {
        from: changeLockingCapAuthorizer1Address
      });
    });

    it('should fail when call getUnionBridgeLockingCap', async () => {
      return assertContractCallFails(bridge.methods.getUnionBridgeLockingCap());
    });

    it('should fail when call requestUnionBridgeRbtc', async () => {
      return assertContractCallFails(unionBridgeContract.methods.requestUnionBridgeRbtc(AMOUNT_TO_REQUEST), {
        from: unionBridgeContractCreatorAddress
      });
    });

    it('should fail when call releaseUnionBridgeRbtc', async () => {
      return assertContractCallFails(unionBridgeContract.methods.releaseUnionBridgeRbtc(AMOUNT_TO_RELEASE), {
        from: unionBridgeContractCreatorAddress
      });
    });

    it('should fail when call setUnionBridgeTransferPermissions', async () => {
      return assertContractCallFails(bridge.methods.setUnionBridgeTransferPermissions(REQUEST_PERMISSION_ENABLED, RELEASE_PERMISSION_ENABLED), {
        from: changeTransferPermissionsAuthorizer1Address
      });
    });
  });
}

const importAccounts = async (rskTxHelper, privateKeys) => {
  const importedAddresses = [];
  for (const privateKey of privateKeys) {
    const address = await rskTxHelper.importAccount(privateKey);
    importedAddresses.push(address);
  }
  return importedAddresses;
};

const assertContractCallFails = async (methodCall, options) => {
  await expect(methodCall.call(options)).to.be.rejected;
};

const createAndFundAccounts = async () => {
  const importedNotAuthorizedAddresses = await importAccounts(rskTxHelper, [UNAUTHORIZED_1_PRIVATE_KEY]);
  unauthorizedAddress = importedNotAuthorizedAddresses[0];

  const unionAuthorizedAddresses = await importAccounts(rskTxHelper, [
    CHANGE_UNION_BRIDGE_CONTRACT_ADDRESS_AUTHORIZER_PK,
    ...CHANGE_LOCKING_CAP_AUTHORIZERS_PKS.slice(0, 2),
    ...CHANGE_TRANSFER_PERMISSIONS_AUTHORIZERS_PKS.slice(0, 2)
  ]);
  changeUnionAddressAuthorizerAddress = unionAuthorizedAddresses[0];
  changeLockingCapAuthorizer1Address = unionAuthorizedAddresses[1];
  changeLockingCapAuthorizer2Address = unionAuthorizedAddresses[2];
  changeTransferPermissionsAuthorizer1Address = unionAuthorizedAddresses[3];
  changeTransferPermissionsAuthorizer2Address = unionAuthorizedAddresses[4];

  // Sending some funds to the not authorized addresses to pay for transaction fees while voting.
  // This is done to realistically test the union bridge methods, so it doesn't fail by something else like insufficient funds.
  await rskUtils.sendFromCow(rskTxHelper, unauthorizedAddress, btcToWeis(0.1));

  // Send some funds to the union authorizers to pay for transaction fees while voting.
  await rskUtils.sendFromCow(rskTxHelper, changeUnionAddressAuthorizerAddress, btcToWeis(0.1));
  await rskUtils.sendFromCow(rskTxHelper, changeLockingCapAuthorizer1Address, btcToWeis(0.1));
  await rskUtils.sendFromCow(rskTxHelper, changeLockingCapAuthorizer2Address, btcToWeis(0.1));
  await rskUtils.sendFromCow(rskTxHelper, changeTransferPermissionsAuthorizer1Address, btcToWeis(0.1));
  await rskUtils.sendFromCow(rskTxHelper, changeTransferPermissionsAuthorizer2Address, btcToWeis(0.1));
}

(async () => {
  await execute("Call Union Bridge Methods before Reed - tests");
})();
