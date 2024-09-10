const whitelistingAssertions = require('../lib/assertions/whitelisting');
const { getBridge } = require('../lib/precompiled-abi-forks-util');
const contractMethodAssertions = require('../lib/assertions/contractMethods');
const expect = require('chai').expect;
const CustomError = require('../lib/CustomError');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');

let bridge;
let rskTxHelper;

const WHITELIST_ADDRESSES = {
    'mq4w7mWwCtCURdbB3m3EVXqtJiVBdXcEaK' : 100000000000,
    'mx9PWbBKJxiR7xfV8i6TJnbVZoVLgv66vm' : 100000000000,
    'mnr8aGuc3tZb63gyssWssAz98LEojwTs9b' : 100000000000
  };


describe('RFS-170 test before fork', () => {
    const RFS_170_ACTIVATION_BLOCK = Runners.common.forks.orchid.activationHeight;
    
    before(async () => {
        rskTxHelper = getRskTransactionHelper();
        bridge = getBridge(rskTxHelper.getClient());
    });

    it(`should be at a height lower than ${RFS_170_ACTIVATION_BLOCK}`, async () => {
        try{
            const blockNum = await rskTxHelper.getBlockNumber();
            expect(blockNum < RFS_170_ACTIVATION_BLOCK).to.be.true;
        }
        catch (err) {
            throw new CustomError('Activation block height failure', err);
        }
    });

    it('should add address to the whitelist using old addLockWhitelistAddress', () => {
        const whitelistAddress = Object.entries(WHITELIST_ADDRESSES)[0];
        return whitelistingAssertions.assertAddLockWhitelistAddress(rskTxHelper, whitelistAddress[0], whitelistAddress[1]);
    });

    it('should NOT get the entry by address using new getLockWhitelistEntryByAddress', () => {
        return contractMethodAssertions.assertContractCallFails(
            bridge.methods.getLockWhitelistEntryByAddress(Object.entries(WHITELIST_ADDRESSES)[0][0])
        );
    });

    it('should remove address from the whitelist', () => {
        return whitelistingAssertions.assertRemoveWhitelistAddress(rskTxHelper, Object.entries(WHITELIST_ADDRESSES)[0][0]);
    });

    it('should NOT add addresses to the whitelist using UNLIMITED', () => {
        return contractMethodAssertions.assertContractCallFails(
            bridge.methods.addUnlimitedLockWhitelistAddress(Object.entries(WHITELIST_ADDRESSES)[0][0])
        );
    });
    
    it('should NOT add addresses to the whitelist using ONE-OFF', () => {
        const whitelistAddress = Object.entries(WHITELIST_ADDRESSES)[0];
        return contractMethodAssertions.assertContractCallFails(
            bridge.methods.addOneOffLockWhitelistAddress(whitelistAddress[0], whitelistAddress[1])
        );
    });    
});
