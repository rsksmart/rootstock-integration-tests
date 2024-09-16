const expect = require('chai').expect;
const rskUtilsLegacy = require('../rsk-utils-legacy');

const WHITELIST_CHANGE_PK = '3890187a3071327cee08467ba1b44ed4c13adb2da0d5ffcc0563c371fa88259c';
const WHITELIST_CHANGE_ADDR = '87d2a0f33744929da08b65fd62b627ea52b25f8e';

const getUnlockedAddress = async (rskClient, privateKey, address) => {
  const importedAddress = await rskClient.eth.personal.importRawKey(privateKey, '');
  expect(importedAddress.slice(2)).to.equal(address);
  return rskClient.eth.personal.unlockAccount(importedAddress, '');
};

const assertAddLimitedLockWhitelistAddress = (btcClient, rskClient) => (address, maxTransferValue) => async () => {
  return assertAddOneOffWhitelistAddress(btcClient, rskClient)(address, maxTransferValue)();
};

const assertAddOneOffWhitelistAddress = (btcClient, rskClient) => (address, maxTransferValue) => async () => {
  
  const utils = rskUtilsLegacy.with(btcClient, rskClient);

  const initialWhitelistSize = Number(await rskClient.rsk.bridge.methods.getLockWhitelistSize().call());

  const unlocked = await getUnlockedAddress(rskClient, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);

  expect(unlocked).to.be.true;

  const addOneOffLockWhitelistAddressMethod = rskClient.rsk.bridge.methods.addOneOffLockWhitelistAddress(address, maxTransferValue);

  await utils.sendTxWithCheck(addOneOffLockWhitelistAddressMethod, addResult => expect(Number(addResult)).to.equal(1), WHITELIST_CHANGE_ADDR)();

  const addResult = Number(await rskClient.rsk.bridge.methods.addOneOffLockWhitelistAddress(address, maxTransferValue).call({ from: WHITELIST_CHANGE_ADDR }));

  expect(addResult).to.equal(-1);

  const finalLockWhitelistSize = Number(await rskClient.rsk.bridge.methods.getLockWhitelistSize().call());

  expect(finalLockWhitelistSize).to.equal(initialWhitelistSize + 1);

  await assertWhitelistAddressPresence(address, true)();

};

const assertAddLockWhitelistAddress = (btcClient, rskClient) => (address, maxTransferValue) => async () => {

    const utils = rskUtilsLegacy.with(btcClient, rskClient);

    await assertWhitelistAddressPresence(address, false)();

    const unlocked = await getUnlockedAddress(rskClient, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);

    expect(unlocked).to.be.true;

    const addLockWhitelistAddressMethod = rskClient.rsk.bridge.methods.addLockWhitelistAddress(address, maxTransferValue);

    await utils.sendTxWithCheck(addLockWhitelistAddressMethod, addResult => expect(Number(addResult)).to.be.equal(1), WHITELIST_CHANGE_ADDR)();

    await assertWhitelistAddressPresence(address, true)();

  };

const assertAddUnlimitedWhitelistAddress = (btcClient, rskClient) => (address) => async () => {

  const utils = rskUtilsLegacy.with(btcClient, rskClient);

  const initialWhitelistSize = Number(await rskClient.rsk.bridge.methods.getLockWhitelistSize().call());

  const unlocked = await getUnlockedAddress(rskClient, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);

  expect(unlocked).to.be.true;

  const addUnlimitedLockWhitelistAddressMethod = rskClient.rsk.bridge.methods.addUnlimitedLockWhitelistAddress(address);

  await utils.sendTxWithCheck(addUnlimitedLockWhitelistAddressMethod, addResult => expect(Number(addResult)).to.equal(1), WHITELIST_CHANGE_ADDR)();

  const addResult = Number(await rskClient.rsk.bridge.methods.addUnlimitedLockWhitelistAddress(address).call({ from: WHITELIST_CHANGE_ADDR }));

  expect(addResult).to.equal(-1);

  const finalWhitelistSize = Number(await rskClient.rsk.bridge.methods.getLockWhitelistSize().call());

  expect(finalWhitelistSize).to.equal(initialWhitelistSize + 1);

  await assertWhitelistAddressPresence(address, true)();

};

const assertRemoveWhitelistAddress = (btcClient, rskClient) => (address) => async () => {

  const utils = rskUtilsLegacy.with(btcClient, rskClient);
  
  const initialWhitelistSize = Number(await rskClient.rsk.bridge.methods.getLockWhitelistSize().call());

  await assertWhitelistAddressPresence(rskClient)(address, true)();

  const removeLockWhitelistAddressMethod = rskClient.rsk.bridge.methods.removeLockWhitelistAddress(address);

  await utils.sendTxWithCheck(removeLockWhitelistAddressMethod, (removeResult) => expect(Number(removeResult)).to.equal(1), WHITELIST_CHANGE_ADDR)();

  await assertWhitelistAddressPresence(rskClient)(address, false)();

  const removeResult = Number(await rskClient.rsk.bridge.methods.removeLockWhitelistAddress(address).call({ from: WHITELIST_CHANGE_ADDR }));

  expect(removeResult).to.equal(-1);

  const finalWhitelistSize = Number(await rskClient.rsk.bridge.methods.getLockWhitelistSize().call());

  expect(finalWhitelistSize).to.equal(initialWhitelistSize - 1);

};

const assertWhitelistAddressPresence = (rskClient) => (address, present) => async () => {

  const whitelistSize = Number(await rskClient.rsk.bridge.methods.getLockWhitelistSize().call());
  const isPresentFromIndex = async (addressToSearch, size, index) => {
    for(let i = index; i < size; i++) {
      const returnedAddress = await rskClient.rsk.bridge.methods.getLockWhitelistAddress(i).call();
      if(returnedAddress === addressToSearch) {
        return true;
      }
    }
    return false;
  };
  const isPresent = await isPresentFromIndex(address, whitelistSize, 0);
  expect(isPresent).to.equal(present);
  
};

module.exports = {
  with: (btcClient, rskClient) => {
      return {
        assertAddOneOffWhitelistAddress: assertAddOneOffWhitelistAddress(btcClient, rskClient),
        assertAddUnlimitedWhitelistAddress: assertAddUnlimitedWhitelistAddress(btcClient, rskClient),
        assertRemoveWhitelistAddress: assertRemoveWhitelistAddress(btcClient, rskClient),
        assertWhitelistAddressPresence: assertWhitelistAddressPresence(rskClient),
        assertAddLockWhitelistAddress: assertAddLockWhitelistAddress(btcClient, rskClient),
        assertAddLimitedLockWhitelistAddress: assertAddLimitedLockWhitelistAddress(btcClient, rskClient),
      };
  }
};
