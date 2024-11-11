const expect = require('chai').expect;
const rskUtils = require('../rsk-utils');
const { getBridge } = require('../bridge-provider');

const WHITELIST_CHANGE_PK = '3890187a3071327cee08467ba1b44ed4c13adb2da0d5ffcc0563c371fa88259c';
const WHITELIST_CHANGE_ADDR = '87d2a0f33744929da08b65fd62b627ea52b25f8e';

/**
 * 
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} btcAddress to be added to the bridge whitelist.
 * @param {number} maxTransferValueInSatoshis max transfer value in satoshis that the `btcAddress` is allowed to transfer in a pegin transaction.
 * @returns {Promise<void>}
 */
const assertAddLimitedLockWhitelistAddress = async (rskTxHelper, btcAddress, maxTransferValueInSatoshis) => {
  return await assertAddOneOffWhitelistAddress(rskTxHelper, btcAddress, maxTransferValueInSatoshis);
};

/**
 * Adds a btcAddress to the bridge whitelist with a max transfer value by using the bridge `addOneOffLockWhitelistAddress` method and then asserts
 * that if the btcAddress is already in the whitelist, then trying to add it to the bridge whitelist again will not add it again and
 * asserts that the btcAddress was added to the whitelist by searching for it in the bridge whitelist.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} btcAddress to be added to the bridge whitelist.
 * @param {number} maxTransferValueInSatoshis max transfer value in satoshis that the `btcAddress` is allowed to transfer in a pegin transaction.
 */
const assertAddOneOffWhitelistAddress = async (rskTxHelper, btcAddress, maxTransferValueInSatoshis) => {

  const bridge = getBridge(rskTxHelper.getClient());

  const initialWhitelistSize = Number(await bridge.methods.getLockWhitelistSize().call());

  const unlocked = await rskUtils.getUnlockedAddress(rskTxHelper, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);

  expect(unlocked).to.be.true;

  const addOneOffLockWhitelistAddressMethod = bridge.methods.addOneOffLockWhitelistAddress(btcAddress, maxTransferValueInSatoshis);

  await rskUtils.sendTxWithCheck(rskTxHelper, addOneOffLockWhitelistAddressMethod, WHITELIST_CHANGE_ADDR, addResult => expect(Number(addResult)).to.equal(1));

  const addResult = Number(await bridge.methods.addOneOffLockWhitelistAddress(btcAddress, maxTransferValueInSatoshis).call({ from: WHITELIST_CHANGE_ADDR }));

  expect(addResult).to.equal(-1);

  const finalLockWhitelistSize = Number(await bridge.methods.getLockWhitelistSize().call());

  expect(finalLockWhitelistSize).to.equal(initialWhitelistSize + 1);

  await assertWhitelistAddressPresence(rskTxHelper, btcAddress, true);

};

/**
 * Adds a btcAddress to the bridge whitelist with a max transfer value by using the bridge `addLockWhitelistAddress` method and then asserts
 * that if the btcAddress is already in the whitelist, then trying to add it to the bridge whitelist again will not add it again and
 * asserts that the btcAddress was added to the whitelist by searching for it in the bridge whitelist.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} btcAddress to be added to the bridge whitelist.
 * @param {number} maxTransferValueInSatoshis max transfer value in satoshis that the `btcAddress` is allowed to transfer in a pegin transaction.
 */
const assertAddLockWhitelistAddress = async (rskTxHelper, btcAddress, maxTransferValueInSatoshis) => {

    const bridge = getBridge(rskTxHelper.getClient());

    await assertWhitelistAddressPresence(rskTxHelper, btcAddress, false);

    const unlocked = await rskUtils.getUnlockedAddress(rskTxHelper, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);

    expect(unlocked).to.be.true;

    const addLockWhitelistAddressMethod = bridge.methods.addLockWhitelistAddress(btcAddress, maxTransferValueInSatoshis);

    await rskUtils.sendTxWithCheck(rskTxHelper, addLockWhitelistAddressMethod, WHITELIST_CHANGE_ADDR, addResult => expect(Number(addResult)).to.be.equal(1));

    await assertWhitelistAddressPresence(rskTxHelper, btcAddress, true);

};

/**
 * Adds a btcAddress to the bridge whitelist with an unlimited max transfer value by using the bridge `addUnlimitedLockWhitelistAddress` method and then asserts
 * that if the btcAddress is already in the whitelist, then trying to add it to the bridge whitelist again will not add it again and
 * asserts that the btcAddress was added to the whitelist by searching for it in the bridge whitelist.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} btcAddress to be added to the bridge whitelist.
 */
const assertAddUnlimitedWhitelistAddress = async (rskTxHelper, btcAddress) => {

  const bridge = getBridge(rskTxHelper.getClient());

  const initialWhitelistSize = Number(await bridge.methods.getLockWhitelistSize().call());

  const unlocked = await rskUtils.getUnlockedAddress(rskTxHelper, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);

  expect(unlocked).to.be.true;

  const addUnlimitedLockWhitelistAddressMethod = bridge.methods.addUnlimitedLockWhitelistAddress(btcAddress);

  await rskUtils.sendTxWithCheck(rskTxHelper, addUnlimitedLockWhitelistAddressMethod, WHITELIST_CHANGE_ADDR, addResult => expect(Number(addResult)).to.equal(1));

  const addResult = Number(await bridge.methods.addUnlimitedLockWhitelistAddress(btcAddress).call({ from: WHITELIST_CHANGE_ADDR }));

  expect(addResult).to.equal(-1);

  const finalWhitelistSize = Number(await bridge.methods.getLockWhitelistSize().call());

  expect(finalWhitelistSize).to.equal(initialWhitelistSize + 1);

  await assertWhitelistAddressPresence(rskTxHelper, btcAddress, true);

};

/**
 * Removes a btcAddress from the bridge whitelist by using the bridge `removeLockWhitelistAddress` method and then asserts
 * that if the btcAddress is not in the whitelist, then trying to remove it from the bridge whitelist again will not remove it again and
 * asserts that the btcAddress was removed from the whitelist by searching for it in the bridge whitelist and expecting it to not be present.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} btcAddress 
 */
const assertRemoveWhitelistAddress = async (rskTxHelper, btcAddress) => {

  const bridge = getBridge(rskTxHelper.getClient());
  
  const initialWhitelistSize = Number(await bridge.methods.getLockWhitelistSize().call());

  await assertWhitelistAddressPresence(rskTxHelper, btcAddress, true);

  const removeLockWhitelistAddressMethod = bridge.methods.removeLockWhitelistAddress(btcAddress);

  await rskUtils.sendTxWithCheck(rskTxHelper, removeLockWhitelistAddressMethod, WHITELIST_CHANGE_ADDR, (removeResult) => expect(Number(removeResult)).to.equal(1));

  await assertWhitelistAddressPresence(rskTxHelper, btcAddress, false);

  const removeResult = Number(await bridge.methods.removeLockWhitelistAddress(btcAddress).call({ from: WHITELIST_CHANGE_ADDR }));

  expect(removeResult).to.equal(-1);

  const finalWhitelistSize = Number(await bridge.methods.getLockWhitelistSize().call());

  expect(finalWhitelistSize).to.equal(initialWhitelistSize - 1);

};

/**
 * Searches for the btcAddress in the bridge whitelist and asserts that the btcAddress is present if `present` is true, or that the btcAddress is not present if `present` is false.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} btcAddress 
 * @param {Promise<void>}
 */
const assertWhitelistAddressPresence = async (rskTxHelper, btcAddress, present) => {

  const bridge = getBridge(rskTxHelper.getClient());

  const whitelistSize = Number(await bridge.methods.getLockWhitelistSize().call());

  const isPresentFromIndex = async (addressToSearch, size, index) => {
    for(let i = index; i < size; i++) {
      const returnedAddress = await bridge.methods.getLockWhitelistAddress(i).call();
      if(returnedAddress === addressToSearch) {
        return true;
      }
    }
    return false;
  };
  const isPresent = await isPresentFromIndex(btcAddress, whitelistSize, 0);
  expect(isPresent).to.equal(present);
  
};

module.exports = {
    assertAddOneOffWhitelistAddress,
    assertAddUnlimitedWhitelistAddress,
    assertRemoveWhitelistAddress,
    assertWhitelistAddressPresence,
    assertAddLockWhitelistAddress,
    assertAddLimitedLockWhitelistAddress,
    WHITELIST_CHANGE_PK,
    WHITELIST_CHANGE_ADDR,
};
