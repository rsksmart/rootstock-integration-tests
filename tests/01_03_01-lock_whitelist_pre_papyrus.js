const expect = require('chai').expect
const { removePrefix0x } = require('../lib/utils');
const  {
  assertAddUnlimitedWhitelistAddress,
  assertAddOneOffWhitelistAddress,
  assertRemoveWhitelistAddress,
  WHITELIST_CHANGE_PK,
  WHITELIST_CHANGE_ADDR
} = require('../lib/assertions/whitelisting');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getBridge } = require('../lib/precompiled-abi-forks-util');

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

});
