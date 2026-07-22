const expect = require('chai').expect;
const rskUtils = require('../../../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../../../lib/rsk-tx-helper-provider');
const { getBridge } = require('../../../lib/bridge-provider');
const { btcToSatoshis } = require('@rsksmart/btc-eth-unit-converter');
const {
    GENESIS_FEE_PER_KB,
    MAX_FEE_PER_KB,
    FEE_PER_KB_RESPONSE_CODES,
} = require('../../../lib/constants/fee-per-kb-constants');

const RANDOM_ADDR = '42a3d6e125aad539ac15ed04e1478eb0a4dc1489';

describe('@regression @bridge-methods Fee per kb change voting', function () {
    let rskTxHelper;
    let bridge;

    before(async () => {
        rskTxHelper = getRskTransactionHelpers()[0];
        bridge = await getBridge(rskTxHelper.getClient());
    });

    it('should have a default fee per kb of millicoin', async () => {
        const feePerKb = await bridge.getFeePerKb();
        expect(Number(feePerKb)).to.equal(GENESIS_FEE_PER_KB);
    });

    it('should reject unauthorized votes', async () => {
        const newFeePerKb = Number(btcToSatoshis(0.005));

        // A read-only call needs no account in the node wallet; `from` is just the simulated sender.
        const result = await bridge.voteFeePerKbChange.staticCall(newFeePerKb, {
            from: RANDOM_ADDR,
        });
        expect(Number(result)).to.equal(FEE_PER_KB_RESPONSE_CODES.UNAUTHORIZED_CALLER);

        const feePerKb = await bridge.getFeePerKb();
        expect(Number(feePerKb)).to.equal(GENESIS_FEE_PER_KB);
    });

    it('should reject votes above the max fee per kb value', async () => {
        const newFeePerKb = MAX_FEE_PER_KB + 1;

        await rskUtils.voteFeePerKbChange(
            rskTxHelper,
            newFeePerKb,
            FEE_PER_KB_RESPONSE_CODES.EXCESSIVE_FEE_VOTED
        );

        const feePerKb = await bridge.getFeePerKb();
        expect(Number(feePerKb)).to.equal(GENESIS_FEE_PER_KB);
    });

    it('should be able to vote and change the fee per kb', async () => {
        const newFeePerKb = Number(btcToSatoshis(0.005));

        // setFeePerKb votes with the changer account and asserts
        // both the vote result and the resulting fee per kb value.
        await rskUtils.setFeePerKb(rskTxHelper, newFeePerKb);

        // Changing back the fee per kb
        await rskUtils.setFeePerKb(rskTxHelper, GENESIS_FEE_PER_KB);
    });
});
