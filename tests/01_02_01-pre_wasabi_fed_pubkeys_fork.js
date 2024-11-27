const contractMethodAssertions = require('../lib/assertions/contractMethods');
const expect = require('chai').expect;
const { assertIsPublicKey } = require('../lib/assertions/misc');
const { KEY_TYPE_BTC } = require('../lib/constants/federation-constants');
const CustomError = require('../lib/CustomError');
const { getBridge } = require('../lib/bridge-provider');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');

const RANDOM_PUBLIC_KEY = '0x02f9284f96eb093918a9da825111aec70a51152800e60249ac156ac35d2fa771ba';
const FEDERATION_CHANGE_PK = 'c14991a187e185ca1442e75eb8f60a6a5efd4ca57ce31e50d6e841d9381e996b';

let rskTxHelper;
let fedChangeAddress;
let preWasabiBridge;
let postWasabiBridge;

describe('Multiple federation member keys test before fork', () => {
    
    const ACTIVATION_BLOCK = Runners.common.forks.wasabi100.activationHeight;

    before(async () => {
        rskTxHelper = getRskTransactionHelper();
        fedChangeAddress = await rskTxHelper.importAccount(FEDERATION_CHANGE_PK, '');
        preWasabiBridge = getBridge(rskTxHelper.getClient());
        postWasabiBridge = getBridge(rskTxHelper.getClient());
    });

    it(`should be at a height lower than ${ACTIVATION_BLOCK}`, async () => {
        try{
            const blockNumber = await rskTxHelper.getBlockNumber();
            expect(blockNumber < ACTIVATION_BLOCK).to.be.true;
        }
        catch (err) {
            throw new CustomError('Activation block height failure', err);
        }
    });

    it('method getFederatorPublicKey should work', () => {
        return contractMethodAssertions.assertContractCallReturnsWithCallback(
            preWasabiBridge.methods.getFederatorPublicKey(0),
            assertIsPublicKey
        );
    });

    it('method getFederatorPublicKeyOfType should NOT work', () => {
        return contractMethodAssertions.assertContractCallFails(
            postWasabiBridge.methods.getFederatorPublicKeyOfType(0, KEY_TYPE_BTC)
        );
    });

    it('method addFederatorPublicKey should work', () => {
        return contractMethodAssertions.assertContractCallReturnsWithCallback(
            preWasabiBridge.methods.addFederatorPublicKey(RANDOM_PUBLIC_KEY),
            (result) => {
              expect(Number(result)).to.equal(-1);
            }, {
              from: fedChangeAddress
            }
        );
    });
    
    it('method addFederatorPublicKeyMultikey should NOT work', () => {
        return contractMethodAssertions.assertContractCallFails(
            postWasabiBridge.methods.addFederatorPublicKeyMultikey(
              RANDOM_PUBLIC_KEY, RANDOM_PUBLIC_KEY, RANDOM_PUBLIC_KEY
            ), {
              from: fedChangeAddress
            }
        );
    });
});
