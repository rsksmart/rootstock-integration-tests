const { assertContractCallFails, assertContractCallReturnsWithCallback } = require('../lib/assertions/contractMethods');
const expect = require('chai').expect;
const { assertIsPublicKey } = require('../lib/assertions/misc');
const { KEY_TYPE_BTC } = require('../lib/constants/federation-constants');
const { getBridge } = require('../lib/bridge-provider');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');

const RANDOM_PUBLIC_KEY = '0x02f9284f96eb093918a9da825111aec70a51152800e60249ac156ac35d2fa771ba';
const FEDERATION_CHANGE_PK = 'c14991a187e185ca1442e75eb8f60a6a5efd4ca57ce31e50d6e841d9381e996b';

let rskTxHelper;
let fedChangeAddress;
let bridge;

describe('Multiple federation member keys test after fork', () => {

    before(async () => {
        rskTxHelper = getRskTransactionHelper();
        fedChangeAddress = await rskTxHelper.importAccount(FEDERATION_CHANGE_PK);
        bridge = getBridge(rskTxHelper.getClient());
    });

    it('method getFederatorPublicKey should NOT work', () => {
        return assertContractCallFails(bridge.methods.getFederatorPublicKey(0));
    });

    it('method getFederatorPublicKeyOfType should work', () => {
        return assertContractCallReturnsWithCallback(
            bridge.methods.getFederatorPublicKeyOfType(0, KEY_TYPE_BTC),
            assertIsPublicKey
        );
    });

    it('method addFederatorPublicKey should NOT work', () => {
        return assertContractCallFails(
            bridge.methods.addFederatorPublicKey(RANDOM_PUBLIC_KEY), {
              from: fedChangeAddress
            }
        );
    });
    
    it('method addFederatorPublicKeyMultikey should work', () => {

        const addFederatorPublicKeyMultikeyMethod = bridge.methods.addFederatorPublicKeyMultikey(
            RANDOM_PUBLIC_KEY, RANDOM_PUBLIC_KEY, RANDOM_PUBLIC_KEY
        );

        const checkCallback = result => expect(Number(result)).to.equal(-1);

        const callParams = {
            from: fedChangeAddress
        };

        return assertContractCallReturnsWithCallback(addFederatorPublicKeyMultikeyMethod, checkCallback, callParams);

    });
});
