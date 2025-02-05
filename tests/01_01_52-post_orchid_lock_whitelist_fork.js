const whitelistingAssertions = require('../lib/assertions/whitelisting');
const contractMethodAssertions = require('../lib/assertions/contractMethods');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBridge } = require('../lib/bridge-provider');

const WHITELIST_ADDRESSES = {
    'mq4w7mWwCtCURdbB3m3EVXqtJiVBdXcEaK' : 100000000000,
    'mx9PWbBKJxiR7xfV8i6TJnbVZoVLgv66vm' : 100000000000,
    'mnr8aGuc3tZb63gyssWssAz98LEojwTs9b' : 100000000000
};

const WHITELIST_ADDRESSES_ENTRIES = Object.entries(WHITELIST_ADDRESSES);

let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;
let bridge;

describe('RFS-170 test after fork', () => {
    before(async () => {
        btcTxHelper = getBtcClient();
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        bridge = await getBridge(rskTxHelper.getClient());

    });

    it('should add address to the whitelist using UNLIMITED', () => {
        const address = WHITELIST_ADDRESSES_ENTRIES[0][0];
        return whitelistingAssertions.assertAddUnlimitedWhitelistAddress(rskTxHelper, address);
    });

    it('should add address to the whitelist using ONE-OFF', () => {
        const secondWhitelistAddressEntry = WHITELIST_ADDRESSES_ENTRIES[1];
        const address = secondWhitelistAddressEntry[0];
        const maxTransferValue = secondWhitelistAddressEntry[1];
        return whitelistingAssertions.assertAddOneOffWhitelistAddress(rskTxHelper, address, maxTransferValue);
    });

    it('should get the entry by address using new getLockWhitelistEntryByAddress', () => {
        // this test is depending on the ONE-OFF address getting created with a specific max transfer value
        const secondAddressEntry = WHITELIST_ADDRESSES_ENTRIES[1];
        const address = secondAddressEntry[0];
        const maxTransferValue = secondAddressEntry[1];
        const getLockWhitelistEntryByAddressMethod = bridge.methods.getLockWhitelistEntryByAddress(address);
        return contractMethodAssertions.assertContractCallReturns(getLockWhitelistEntryByAddressMethod, maxTransferValue.toString());
    });

    it('should remove addresses from the whitelist', async () => {
        const firstAddress = WHITELIST_ADDRESSES_ENTRIES[0][0];
        const secondAddress = WHITELIST_ADDRESSES_ENTRIES[1][0];
        await whitelistingAssertions.assertRemoveWhitelistAddress(rskTxHelper, firstAddress);
        await whitelistingAssertions.assertRemoveWhitelistAddress(rskTxHelper, secondAddress);
    });
    
    it('should NOT add addresses to the whitelist using old addLockWhitelistAddress', () => {
        const firstWhitelistAddressEntry = WHITELIST_ADDRESSES_ENTRIES[0];
        const address = firstWhitelistAddressEntry[0];
        const maxTransferValue = firstWhitelistAddressEntry[1];
        const addLockWhitelistAddressMethod = bridge.methods.addLockWhitelistAddress(address, maxTransferValue);
        return contractMethodAssertions.assertContractCallFails(addLockWhitelistAddressMethod);
    });
});
