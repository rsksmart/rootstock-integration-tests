const expect = require('chai').expect;
const BN = require('bn.js');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const { btcToWeis, satoshisToBtc, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { assertContractCallFails } = require('../lib/assertions/contractMethods');
const { getBridge } = require('../lib/bridge-provider');
const CustomError = require('../lib/CustomError');
const {
    createSenderRecipientInfo,
    ensurePeginIsRegistered,
    sendPeginToActiveFederation,
    sendTxToBridge,
} = require('../lib/2wp-utils');
const { getBtcClient } = require('../lib/btc-client-provider');
const {
    MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS,
} = require('../lib/constants/pegout-constants');
const { getRskTransactionHelper, getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { sendFromCow, triggerRelease } = require('../lib/rsk-utils');

const FEDERATION_PEGIN_AMOUNT_IN_SATOSHIS = 500_000;
const FEDERATION_PEGIN_AMOUNT_IN_BTC = Number(satoshisToBtc(FEDERATION_PEGIN_AMOUNT_IN_SATOSHIS));
const BTC_FUNDING_AMOUNT_IN_BTC = 2;
const PEGOUT_SENDER_FUNDING_IN_BTC = 2;

let bridge;
let rskTxHelper;
let rskTxHelpers;
let btcTxHelper;

const getQueuedPegoutsCount = async () => Number(await bridge.methods.getQueuedPegoutsCount().call());

describe('getEstimatedFeesForPegOutAmount', () => {
    before(async () => {
        rskTxHelper = getRskTransactionHelper();
        rskTxHelpers = getRskTransactionHelpers();
        btcTxHelper = getBtcClient();
        bridge = await getBridge(rskTxHelper.getClient());
    });

    beforeEach(async () => {
        await triggerRelease(rskTxHelpers, btcTxHelper);
    });

    afterEach(async () => {
        await triggerRelease(rskTxHelpers, btcTxHelper);
    });

    it('should allow constructing a second pegout request using the estimated fees for pegout amount and process both', async () => {
        try {
            const senderInfo = await createSenderRecipientInfo(
                rskTxHelper,
                btcTxHelper,
                'legacy',
                BTC_FUNDING_AMOUNT_IN_BTC
            );

            const peginBtcTxHash = await sendPeginToActiveFederation(
                rskTxHelper,
                btcTxHelper,
                senderInfo.btcSenderAddressInfo,
                FEDERATION_PEGIN_AMOUNT_IN_BTC
            );
            await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);

            const bridgeStateAfterPegin = await getBridgeState(rskTxHelper.getClient());
            const peginUtxoInBridgeState = bridgeStateAfterPegin.activeFederationUtxos.find(
                (utxo) =>
                    utxo.btcTxHash === peginBtcTxHash &&
                    utxo.valueInSatoshis === FEDERATION_PEGIN_AMOUNT_IN_SATOSHIS
            );
            expect(peginUtxoInBridgeState).to.not.be.undefined;

            await sendFromCow(
                rskTxHelper,
                senderInfo.rskRecipientRskAddressInfo.address,
                Number(btcToWeis(PEGOUT_SENDER_FUNDING_IN_BTC))
            );

            await sendTxToBridge(
                rskTxHelper,
                new BN(satoshisToWeis(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS)),
                senderInfo.rskRecipientRskAddressInfo.address
            );

            const estimatedFeesForPegout = Number(
                await bridge.methods
                    .getEstimatedFeesForPegOutAmount(satoshisToWeis(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS))
                    .call()
            );
            expect(estimatedFeesForPegout).to.be.greaterThan(0);

            const secondPegoutAmountInSatoshis =
                MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS + estimatedFeesForPegout;
            await sendTxToBridge(
                rskTxHelper,
                new BN(satoshisToWeis(secondPegoutAmountInSatoshis)),
                senderInfo.rskRecipientRskAddressInfo.address
            );

            const countBeforeRelease = await getQueuedPegoutsCount();
            expect(countBeforeRelease).to.equal(2);

            await triggerRelease(rskTxHelpers, btcTxHelper);

            const countAfterRelease = await getQueuedPegoutsCount();
            expect(countAfterRelease).to.equal(0);
        } catch (err) {
            throw new CustomError(
                'Error validating getEstimatedFeesForPegOutAmount with two pegouts',
                err
            );
        }
    });

    it('should revert when peg-out amount in weis is below minimum peg-out', async () => {
        await assertContractCallFails(
            bridge.methods.getEstimatedFeesForPegOutAmount(
                satoshisToWeis(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS - 1)
            )
        );
    });
});
