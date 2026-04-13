const expect = require('chai').expect;
const BN = require('bn.js');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const { btcToWeis, satoshisToBtc, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { assertContractCallFails } = require('../assertions/contractMethods');
const { getBridge } = require('../bridge-provider');
const CustomError = require('../CustomError');
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

    const getEstimatedFeesForNextPegoutEvent = async () =>
        Number(await bridge.methods.getEstimatedFeesForNextPegOutEvent().call());

    const setupFedUtxosAndCreateAPegoutRequest = async () => {
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

    const assertReleaseRequestsAreProcessed = async () => {
        const countBeforeRelease = await getQueuedPegoutsCount();
        const expectedPegoutCount = 2;
        expect(countBeforeRelease).to.equal(expectedPegoutCount);

        await triggerRelease(rskTxHelpers, btcTxHelper);

        const countAfterRelease = await getQueuedPegoutsCount();
        expect(countAfterRelease).to.equal(0);
    };

    describe(description, () => {
        before(async () => {
            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            btcTxHelper = getBtcClient();
            bridge = await getBridge(rskTxHelper.getClient());
        });

        beforeEach(async () => {
            await triggerRelease(rskTxHelpers, btcTxHelper);
            await setupFedUtxosAndCreateAPegoutRequest();
        });

        afterEach(async () => {
            await triggerRelease(rskTxHelpers, btcTxHelper);
        });

        describe('getEstimatedFeesForNextPegOutEvent', () => {
            it('should allow constructing a second pegout request using the fees from getEstimatedFeesForNextPegoutEvent and process both', async () => {
                try {
                    const estimatedFeesForNextPegout = await getEstimatedFeesForNextPegoutEvent();
                    expect(estimatedFeesForNextPegout).to.be.greaterThan(0);

                    const secondPegoutAmountInSatoshis =
                        MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS + estimatedFeesForNextPegout;
                    await sendTxToBridge(
                        rskTxHelper,
                        new BN(satoshisToWeis(secondPegoutAmountInSatoshis)),
                        senderInfo.rskRecipientRskAddressInfo.address
                    );

                    await assertReleaseRequestsAreProcessed();
                } catch (err) {
                    throw new CustomError(
                        'Error validating getEstimatedFeesForNextPegOutEvent with two pegouts',
                        err
                    );
                }
            });
        });

        describe('getEstimatedFeesForPegOutAmount', () => {
            it('should allow constructing a second pegout request using the estimated fees from getEstimatedFeesForPegOutAmount and process both', async () => {
                try {
                    const estimatedFeesForPegout = Number(await bridge.methods
                        .getEstimatedFeesForPegOutAmount(satoshisToWeis(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS))
                        .call());
                    expect(estimatedFeesForPegout).to.be.greaterThan(0);

                    const secondPegoutAmountInSatoshis =
                        MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS + estimatedFeesForPegout;
                    await sendTxToBridge(
                        rskTxHelper,
                        new BN(satoshisToWeis(secondPegoutAmountInSatoshis)),
                        senderInfo.rskRecipientRskAddressInfo.address
                    );

                    await assertReleaseRequestsAreProcessed();
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
    });
};

module.exports = {
    execute,
};
