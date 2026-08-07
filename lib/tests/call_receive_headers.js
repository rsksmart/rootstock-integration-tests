const expect = require('chai').expect;
const { getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getBtcClient } = require('../btc-client-provider');
const { getBridge } = require('../bridge-provider');
const { sendTxWithCheck, waitAndUpdateBridge } = require('../rsk-utils');
const { ensure0x } = require('../utils');

let rskTxHelper;
let btcTxHelper;

const execute = (description, getRskHost) => {
    describe(description, function () {
        before(async () => {
            rskTxHelper = getRskTransactionHelper(getRskHost());
            btcTxHelper = getBtcClient();
        });

        it('Calling receiveHeaders method with regular user should not increment BTC blockchain size', async () => {
            const bridge = await getBridge(rskTxHelper.getClient());
            await waitAndUpdateBridge(rskTxHelper);

            const blockNumberInitial = await bridge.getBtcBlockchainBestChainHeight();
            const cowAddress = await rskTxHelper.newAccountWithSeed('cow');
            const blockHashes = await btcTxHelper.mine();
            const blockHeader = await btcTxHelper.getBlockHeader(blockHashes[0], false);

            const checkCallback = (result) => {
                expect(result).to.be.empty;
            };
            await sendTxWithCheck(
                rskTxHelper,
                bridge,
                'receiveHeaders',
                [[ensure0x(blockHeader)]],
                cowAddress,
                checkCallback
            );

            const blockNumberFinal = await bridge.getBtcBlockchainBestChainHeight();
            expect(blockNumberInitial).to.be.equal(blockNumberFinal);
        });
    });
};

module.exports = {
    execute,
};
