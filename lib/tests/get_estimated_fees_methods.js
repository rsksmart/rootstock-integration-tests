const expect = require('chai').expect;
const BN = require('bn.js');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const { btcToWeis, satoshisToBtc, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { assertContractCallFails } = require('../assertions/contractMethods');
const { getBridge } = require('../bridge-provider');
const {
    createSenderRecipientInfo,
    ensurePeginIsRegistered,
    sendPeginToActiveFederation,
    sendTxToBridge,
} = require('../2wp-utils');
const { getBtcClient } = require('../btc-client-provider');
const { MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS } = require('../constants/pegout-constants');
const { getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const { sendFromCow, triggerRelease } = require('../rsk-utils');

const FEDERATION_PEGIN_AMOUNT_IN_SATOSHIS = 500_000;
const FEDERATION_PEGIN_AMOUNT_IN_BTC = Number(satoshisToBtc(FEDERATION_PEGIN_AMOUNT_IN_SATOSHIS));
const BTC_FUNDING_AMOUNT_IN_BTC = 2;
const PEGOUT_SENDER_FUNDING_IN_BTC = 2;

/**
 * @param {string} [description]
 */
const execute = (description) => {
    let bridge;
    let rskTxHelper;
    let rskTxHelpers;
    let btcTxHelper;
    let senderInfo;

    const getQueuedPegoutsCount = async () =>
        Number(await bridge.methods.getQueuedPegoutsCount().call());

    const getEstimatedFeesForNextPegOutEvent = async () =>
        Number(await bridge.methods.getEstimatedFeesForNextPegOutEvent().call());

    const getEstimatedFeesForPegOutAmount = (satoshis) => bridge.methods
                    .getEstimatedFeesForPegOutAmount(satoshisToWeis(satoshis))

    const setupFedUtxosAndAddAPegoutRequestToTheBridge = async () => {
        senderInfo = await createSenderRecipientInfo(
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
    };

    const processReleaseRequestsAndAssertQueueCleared = async () => {
        const countBeforeRelease = await getQueuedPegoutsCount();
        const expectedPegoutCount = 2;
        expect(countBeforeRelease).to.equal(expectedPegoutCount);

        await triggerRelease(rskTxHelpers, btcTxHelper);

        const countAfterRelease = await getQueuedPegoutsCount();
        expect(countAfterRelease).to.equal(0);
    };

    const sendPegoutWithEstimatedFees = async (estimatedFees) => {
        const secondPegoutAmountInSatoshis =
            MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS + estimatedFees;
        await sendTxToBridge(
            rskTxHelper,
            new BN(satoshisToWeis(secondPegoutAmountInSatoshis)),
            senderInfo.rskRecipientRskAddressInfo.address
        );
    };

    describe(description, () => {
        before(async () => {
            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            btcTxHelper = getBtcClient();
            bridge = await getBridge(rskTxHelper.getClient());
        });

        beforeEach(async () => {
            await setupFedUtxosAndAddAPegoutRequestToTheBridge();
        });

        // Ensuring there's no pegout pending in the Bridge contract
        // after each test to avoid interference between tests
        afterEach(async () => {
            await triggerRelease(rskTxHelpers, btcTxHelper);
        });

        describe('getEstimatedFeesForNextPegOutEvent', () => {
            it('should allow constructing a second pegout request using the estimated fees from getEstimatedFeesForNextPegOutEvent and process both', async () => {
                const estimatedFeesForNextPegOut = await getEstimatedFeesForNextPegOutEvent();
                expect(estimatedFeesForNextPegOut).to.be.greaterThan(0);

                await sendPegoutWithEstimatedFees(estimatedFeesForNextPegOut);
                await processReleaseRequestsAndAssertQueueCleared();
            });
        });

        describe('getEstimatedFeesForPegOutAmount', () => {
            it('should allow constructing a second pegout request using the estimated fees from getEstimatedFeesForPegOutAmount and process both', async () => {
                const estimatedFeesForPegout = Number(await getEstimatedFeesForPegOutAmount(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS).call());
                expect(estimatedFeesForPegout).to.be.greaterThan(0);

                await sendPegoutWithEstimatedFees(estimatedFeesForPegout);
                await processReleaseRequestsAndAssertQueueCleared();
            });

            it('should revert when peg-out amount in weis is below minimum peg-out', async () => {
                await assertContractCallFails(
                    getEstimatedFeesForPegOutAmount(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS - 1)
                );
            });
        });
    });
};

module.exports = {
    execute,
};
