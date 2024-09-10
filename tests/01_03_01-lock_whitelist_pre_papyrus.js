const expect = require('chai').expect
const { removePrefix0x } = require('../lib/utils');
const  {
  assertAddUnlimitedWhitelistAddress,
  assertAddOneOffWhitelistAddress,
  assertWhitelistAddressPresence,
  assertRemoveWhitelistAddress,
  WHITELIST_CHANGE_PK,
  WHITELIST_CHANGE_ADDR
} = require('../lib/assertions/whitelisting');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { sendPegin, ensurePeginIsRegistered } = require('../lib/2wp-utils');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const { btcToWeis, btcToSatoshis, satoshisToBtc } = require('@rsksmart/btc-eth-unit-converter');
const { getBridge } = require('../lib/precompiled-abi-forks-util');
const { waitAndUpdateBridge } = require('../lib/rsk-utils');

let rskTxHelpers;
let btcTxHelper;
let rskTxHelper;
let bridge;
let federationAddress;

const EXPECTED_UNSUCCESSFUL_RESULT = -10;
const FUND_AMOUNT_IN_WEIS = 1000000000;

const WHITELIST_ADDRESS_TO_REMOVE = 'mx9PWbBKJxiR7xfV8i6TJnbVZoVLgv66vm';

const WHITELIST_ADDRESSES = {
  'mq4w7mWwCtCURdbB3m3EVXqtJiVBdXcEaK': 100000000000,
  [WHITELIST_ADDRESS_TO_REMOVE]: 100000000000,
  'mnr8aGuc3tZb63gyssWssAz98LEojwTs9b': 100000000000
};

const WHITELIST_RANDOM_PUBLIC_KEY = 'msJRGyaYvT8YNjvU3q9nPgBpZj9umAgetn';

const assertLockCreatingWhiteListAddress = async (rskTxHelper, btcTxHelper, useUnlimitedWhitelist) => {
    const minPeginValueInSatoshis = await bridge.methods.getMinimumLockTxValue().call();
    const minPeginValueInBtc = Number(satoshisToBtc(minPeginValueInSatoshis));

    const btcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
    const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInformation.privateKey, btcTxHelper.btcConfig.network);
    const initialRskAddressBalanceInWeis = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    await btcTxHelper.fundAddress(btcAddressInformation.address, minPeginValueInBtc + btcTxHelper.getFee());

    if (useUnlimitedWhitelist) {
      await assertAddUnlimitedWhitelistAddress(rskTxHelper, btcAddressInformation.address);
    } else {
      await assertAddOneOffWhitelistAddress(rskTxHelper, btcAddressInformation.address, minPeginValueInSatoshis);
    }
    await assertWhitelistAddressPresence(rskTxHelper, btcAddressInformation.address, true);

    const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, btcAddressInformation, minPeginValueInBtc);
    await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);

    await assertWhitelistAddressPresence(rskTxHelper, btcAddressInformation.address, useUnlimitedWhitelist);

    const finalRskAddressBalanceInWeis = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    const peginValueInWeis = Number(btcToWeis(minPeginValueInBtc));
    expect(finalRskAddressBalanceInWeis).to.equal(initialRskAddressBalanceInWeis + peginValueInWeis);
};

const assertNonMatchedAmountsExist = (testCaseAmounts, peginBtcTx, returnTx) => {
  const peginBtcTxHash = peginBtcTx.getHash(false).reverse().toString('hex');
  let nonMatchedAmounts = testCaseAmounts.slice(0);
  returnTx.ins.forEach((txInput) => {
    const inputTxHash = txInput.hash.reverse().toString('hex');
    expect(inputTxHash).to.equal(peginBtcTxHash);
    const spentUtxo = peginBtcTx.outs[txInput.index];
    const amountInBtc = Number(satoshisToBtc(spentUtxo.value));
    nonMatchedAmounts = nonMatchedAmounts.filter(a => a !== amountInBtc);
  });
  expect(nonMatchedAmounts.length).to.equal(0);
}

describe('Lock whitelisting', () => {
    before(async () => {
      rskTxHelpers = getRskTransactionHelpers();
      btcTxHelper = getBtcClient();
      rskTxHelper = rskTxHelpers[0];
      bridge = getBridge(rskTxHelper.getClient());
      
      federationAddress = await bridge.methods.getFederationAddress().call();
      await btcTxHelper.importAddress(federationAddress, 'federations');
    });

    it(`should prevent calling addOneOffLockWhitelistAddress without a correct key`, async () => {
        const addOneOffLockWhitelistAddressMethod = bridge.methods.addOneOffLockWhitelistAddress(WHITELIST_RANDOM_PUBLIC_KEY, FUND_AMOUNT_IN_WEIS);
        const rskTxSenderAddress = await rskTxHelper.newAccountWithSeed('test');
        await rskUtils.sendFromCow(rskTxHelper, rskTxSenderAddress, FUND_AMOUNT_IN_WEIS);
        const checkCallback = callResult => {
          expect(Number(callResult)).to.equal(EXPECTED_UNSUCCESSFUL_RESULT);
        };
        await rskUtils.sendTxWithCheck(rskTxHelper, addOneOffLockWhitelistAddressMethod, rskTxSenderAddress, checkCallback);
    });

    it(`should prevent calling removeLockWhitelistAddress without a correct key`, async () => {
      const removeLockWhitelistAddressMethod = bridge.methods.removeLockWhitelistAddress(WHITELIST_RANDOM_PUBLIC_KEY);
      const rskTxSenderAddress = await rskTxHelper.newAccountWithSeed('test');
      await rskUtils.sendFromCow(rskTxHelper, rskTxSenderAddress, FUND_AMOUNT_IN_WEIS);
      const checkCallback = callResult => {
        expect(Number(callResult)).to.equal(EXPECTED_UNSUCCESSFUL_RESULT);
      };
      await rskUtils.sendTxWithCheck(rskTxHelper, removeLockWhitelistAddressMethod, rskTxSenderAddress, checkCallback);
    });

    it('should return expected WHITELIST_CHANGE_ADDR when WHITELIST_CHANGE_PK is imported', async () => {
      const whitelistChangeAddressResult = await rskTxHelper.importAccount(WHITELIST_CHANGE_PK);
      expect(removePrefix0x(whitelistChangeAddressResult)).to.equal(WHITELIST_CHANGE_ADDR);
      const unlocked = await rskTxHelper.unlockAccount(whitelistChangeAddressResult, '');
      expect(unlocked).to.be.true;
    });

    it('should add addresses to the whitelist using UNLIMITED', async () => {
      const addresses = Object.keys(WHITELIST_ADDRESSES);
      for (let address of addresses){
        await assertAddUnlimitedWhitelistAddress(rskTxHelper, address);
      }
    });
    
    it('should transfer BTC to RBTC from UNLIMITED whitelisted addresses', async () => {
      await assertLockCreatingWhiteListAddress(rskTxHelper, btcTxHelper, true);
    });

    it('should remove addresses from the previously added addresses from the whitelist', async () => {
      const addresses = Object.keys(WHITELIST_ADDRESSES);
      for (let address of addresses) {
        await assertRemoveWhitelistAddress(rskTxHelper, address);
      }
    });
    
    it('should add addresses to the whitelist using ONE-OFF', async () => {
      const addressesValueEntries = Object.entries(WHITELIST_ADDRESSES);
      for (let addressValueEntry of addressesValueEntries){
        const address = addressValueEntry[0];
        const maxTransferValue = addressValueEntry[1];
        await assertAddOneOffWhitelistAddress(rskTxHelper, address, maxTransferValue);
      }
    });

    it('should remove some of the addresses from the whitelist', async () => {
      await assertRemoveWhitelistAddress(rskTxHelper, WHITELIST_ADDRESS_TO_REMOVE);
    });
    
    const nonWhitelistedCasesAmounts = [[15], [5, 7], [1, 23, 4]];

    nonWhitelistedCasesAmounts.forEach(testCaseAmounts => {
      it(`should return BTC from non-whitelisted addresses using same UTXOs as for peg-in attempt (${testCaseAmounts.length} UTXOs)`, async () => {
          const AMOUNT_TO_TRY_TO_LOCK = testCaseAmounts.reduce((a, b) => a + b);
          const MAX_EXPECTED_FEE = 0.001;
          // The extra 0.5 is to get some change back on the lock tx. This shouldn't really
          // change anything, but it will end up considering the most common case.
          const INITIAL_PEGIN_BALANCE = AMOUNT_TO_TRY_TO_LOCK + MAX_EXPECTED_FEE + 0.5;

          const btcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
          const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInformation.privateKey, btcTxHelper.btcConfig.network);
          await btcTxHelper.fundAddress(btcAddressInformation.address, INITIAL_PEGIN_BALANCE);
          const initialFederationBalance = await btcTxHelper.getAddressBalance(federationAddress);

          const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, btcAddressInformation, testCaseAmounts);
          const peginBtcTx = await btcTxHelper.getTransaction(peginBtcTxHash);
          const btcBalanceAfterPegin = await btcTxHelper.getAddressBalance(btcAddressInformation.address);
          expect(Number(btcToSatoshis(btcBalanceAfterPegin))).to.equal(Number(btcToSatoshis(INITIAL_PEGIN_BALANCE - AMOUNT_TO_TRY_TO_LOCK - MAX_EXPECTED_FEE)), 'Lock BTC debit');

          const federationBalanceAfterPegin = await btcTxHelper.getAddressBalance(federationAddress);
          expect(Number(btcToSatoshis(federationBalanceAfterPegin))).to.equal(Number(btcToSatoshis(initialFederationBalance + AMOUNT_TO_TRY_TO_LOCK)), `Lock BTC federation ${federationAddress} credit`);
          
          await waitAndUpdateBridge(rskTxHelper);
          
          const initialBlockNumber = await rskTxHelper.getBlockNumber();
          await rskUtils.mineAndSync(rskTxHelpers);
          const currentBlockNumber = await rskTxHelper.getBlockNumber();
          expect(currentBlockNumber).to.equal(initialBlockNumber + 1);
          
          const currentRskBalance = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
          expect(currentRskBalance, 'Wrong RSK balance').to.equal(0);

          await rskUtils.triggerRelease(rskTxHelpers, getBtcClient());

          const finalBtcAddressBalance = await btcTxHelper.getAddressBalance(btcAddressInformation.address);
          const finalFederationBalance = await btcTxHelper.getAddressBalance(federationAddress);
          const difference = INITIAL_PEGIN_BALANCE - finalBtcAddressBalance;

          // Consider the lock and paying the return fee as well, hence times 2
          expect(difference).to.be.at.most(MAX_EXPECTED_FEE * 2);
          expect(finalFederationBalance).to.equal(initialFederationBalance);

          const utxos = await btcTxHelper.getUtxos(btcAddressInformation.address);
          const nonLockUtxos = utxos.filter(utxo => utxo.txid !== peginBtcTxHash);
          expect(nonLockUtxos.length).to.equal(1);

          const returnUtxo = nonLockUtxos[0];
          expect(AMOUNT_TO_TRY_TO_LOCK - returnUtxo.amount).to.be.at.most(MAX_EXPECTED_FEE);

          const returnTx = await btcTxHelper.getTransaction(returnUtxo.txid);

          expect(returnTx.ins.length).to.equal(peginBtcTx.outs.length - 1); // Don't consider the change output
          expect(returnTx.ins.length).to.equal(testCaseAmounts.length); // Don't consider the change output

          assertNonMatchedAmountsExist(testCaseAmounts, peginBtcTx, returnTx);
      });
    });

    it('should prevent locking RBTC when transfer is above maximum whitelisted', async () => {
      const PEGIN_VALUE_IN_BTC = 1;
      const WHITELISTED_MAX_VALUE = PEGIN_VALUE_IN_BTC - 0.1;

      const btcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
      const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInformation.privateKey, btcTxHelper.btcConfig.network);
      await btcTxHelper.fundAddress(btcAddressInformation.address, PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());

      const initialFederationBalance = await btcTxHelper.getAddressBalance(federationAddress);

      await assertAddOneOffWhitelistAddress(rskTxHelper, btcAddressInformation.address, Number(btcToSatoshis(WHITELISTED_MAX_VALUE)));

      await sendPegin(rskTxHelper, btcTxHelper, btcAddressInformation, PEGIN_VALUE_IN_BTC);

      const btcAddressBalanceAfterPegin = await btcTxHelper.getAddressBalance(btcAddressInformation.address);
      expect(btcAddressBalanceAfterPegin).to.equal(0, 'At this point the btc address should not have any balance');

      const federationBalanceAfterPegin = await btcTxHelper.getAddressBalance(federationAddress);
      expect(federationBalanceAfterPegin).to.equal(initialFederationBalance + PEGIN_VALUE_IN_BTC, 'The federation address should have its balance increased by the pegin amount');

      // Update the bridge to sync
      await waitAndUpdateBridge(rskTxHelper);

      const recipientRskAddressBalance = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
      expect(recipientRskAddressBalance).to.equal(0, 'The recipient rsk address should not have any balance');

      // At this point there is a pegout waiting for confirmations, let's release it.
      await rskUtils.triggerRelease(rskTxHelpers, getBtcClient());

      const btcAddressBalanceAfterRefund = await btcTxHelper.getAddressBalance(btcAddressInformation.address);
      expect(btcAddressBalanceAfterRefund).to.be.within(PEGIN_VALUE_IN_BTC - btcTxHelper.getFee(), PEGIN_VALUE_IN_BTC, 'The btc address should have its balance decreased by about the pegin amount and the fee');
    });

    it('should transfer BTC to RBTC from ONE-OFF whitelisted addresses', async () => {
      await assertLockCreatingWhiteListAddress(rskTxHelper, btcTxHelper, false);
    });
});
