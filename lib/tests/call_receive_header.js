const expect = require('chai').expect;
const { getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getBtcClient } = require('../btc-client-provider');
const { getBridge } = require('../bridge-provider');
const { sendTxWithCheck, waitAndUpdateBridge } = require('../rsk-utils');
const { ensure0x } = require('../utils');

let rskTxHelper;
let btcTxHelper;
let bridge;

const HEADER_RECEIVED_OK = 0;
const RECEIVE_HEADER_CALLED_TOO_SOON = -1;

const execute = (description) => {
    describe(description, function() {  
        before(async () => {
            rskTxHelper = getRskTransactionHelper();
            btcTxHelper = getBtcClient();

            bridge = await getBridge(rskTxHelper.getClient());
        });
    
        it('should return 0 and increment BTC blockchain size when calling receiveHeader method', async () => {
            const cowAddress = await rskTxHelper.newAccountWithSeed('cow');

            await waitAndUpdateBridge(rskTxHelper);

            const blockHashes = await btcTxHelper.mine();
            const blockHeader = await btcTxHelper.getBlockHeader(blockHashes[0], false);
            const blockchainInitialHeigth = await bridge.methods.getBtcBlockchainBestChainHeight().call();

            const receiveHeaderMethodCall = bridge.methods.receiveHeader(ensure0x(blockHeader));
            const checkCallback = (result) => { expect(Number(result)).to.be.equal(HEADER_RECEIVED_OK) };

            await sendTxWithCheck(rskTxHelper, receiveHeaderMethodCall, cowAddress, checkCallback);

            const blockchainFinalHeight = await bridge.methods.getBtcBlockchainBestChainHeight().call();
            expect(Number(blockchainFinalHeight)).to.be.equal(Number(blockchainInitialHeigth) + 1);
        });

        it('should return -1 when calling receiveHeader method consecutively within 5 minutes', async () => {
            const blockHashes = await btcTxHelper.mine();
            const blockHeader = await btcTxHelper.getBlockHeader(blockHashes[0], false);
            const result = await bridge.methods.receiveHeader(ensure0x(blockHeader)).call();
            expect(Number(result)).to.be.equal(RECEIVE_HEADER_CALLED_TOO_SOON);
            }
        );
    });
};

module.exports = {
    execute,
};
