const expect = require('chai').expect;
const { ethers } = require('ethers');
const { getRskTransactionHelpers } = require('../../../lib/rsk-tx-helper-provider');
const { getBridge } = require('../../../lib/bridge-provider');
const { getBtcClient } = require('../../../lib/btc-client-provider');
const { ensure0x } = require('../../../lib/utils');
const {
    UNPROCESSABLE_TX_NOT_CONTRACT_ERROR,
} = require('../../../lib/flyover-pegin-response-codes');

describe('@regression @flyover Calling registerFastBridgeBtcTransaction', function () {
    let rskTxHelper;
    let btcTxHelper;
    let bridge;

    before(async () => {
        rskTxHelper = getRskTransactionHelpers()[0];
        btcTxHelper = getBtcClient();
        bridge = await getBridge(rskTxHelper.getClient());
    });

    it('should return error when user calling registerFastBridgeBtcTransaction method', async () => {
        const randomHex = (size) => ethers.hexlify(ethers.randomBytes(size));
        const stringHex = randomHex(32);
        const randomAddress = randomHex(20);
        const btcAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
        const btcAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(btcAddress));

        const callResult = await bridge.registerFastBridgeBtcTransaction(
            '0x',
            1,
            stringHex,
            stringHex,
            btcAddressBytes,
            randomAddress,
            btcAddressBytes,
            false
        );
        expect(Number(callResult)).to.equal(UNPROCESSABLE_TX_NOT_CONTRACT_ERROR);
    });
});
