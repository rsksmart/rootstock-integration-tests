const expect = require('chai').expect;
const { getRskTransactionHelpers } = require('../../../lib/rsk-tx-helper-provider');
const { getBridge } = require('../../../lib/bridge-provider');
const { getBtcClient } = require('../../../lib/btc-client-provider');
const { ensure0x } = require('../../../lib/utils');
const {
    UNPROCESSABLE_TX_NOT_CONTRACT_ERROR,
} = require('../../../lib/flyover-pegin-response-codes');
const CustomError = require('../../../lib/CustomError');

describe('Calling registerFastBridgeBtcTransaction', function () {
    let rskTxHelper;
    let btcTxHelper;
    let bridge;

    before(async () => {
        rskTxHelper = getRskTransactionHelpers()[0];
        btcTxHelper = getBtcClient();
        bridge = await getBridge(rskTxHelper.getClient());
    });

    it('should return error when user calling registerFastBridgeBtcTransaction method', async () => {
        try {
            const randomHex = rskTxHelper.getClient().utils.randomHex;
            const stringHex = randomHex(32);
            const randomAddress = randomHex(20);
            const btcAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
            const btcAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(btcAddress));

            const callResult = await bridge.methods
                .registerFastBridgeBtcTransaction(
                    '0x',
                    1,
                    stringHex,
                    stringHex,
                    btcAddressBytes,
                    randomAddress,
                    btcAddressBytes,
                    false
                )
                .call();
            expect(Number(callResult)).to.equal(UNPROCESSABLE_TX_NOT_CONTRACT_ERROR);
        } catch (err) {
            throw new CustomError('registerFastBridgeBtcTransaction call failure', err);
        }
    });
});
