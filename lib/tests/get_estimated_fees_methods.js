const expect = require('chai').expect;
const BN = require('bn.js');
const { satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { assertContractCallFails } = require('../assertions/contractMethods');
const { getBridge } = require('../bridge-provider');
const {
    createSenderRecipientInfo,
    ensurePeginIsRegistered,
    sendPeginToActiveFederation,
    sendTxToBridge,
} = require('../2wp-utils');
const { getBtcClient } = require('../btc-client-provider');
const bitcoinJsLib = require('bitcoinjs-lib');
const {
    MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS,
    PEGOUT_EVENTS,
} = require('../constants/pegout-constants');
const { getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const { triggerRelease, getPegoutEventsInBlockRange } = require('../rsk-utils');
const { removePrefix0x } = require('../utils');
const { decodeOutpointValues } = require('../varint');

/**
 * Bitcoin miner fee (satoshis) for the pegout tx in the last `release_btc` event.
 * Uses matching `pegout_transaction_created.utxoOutpointValues` for input amounts.
 *
 * @param {object[]} pegoutsEvents from `getPegoutEventsInBlockRange`
 * @returns {number} fee in satoshis
 */
const getReleaseBtcTransactionFeeInSatoshis = (pegoutsEvents) => {
    // Get the latest event which is the `release_btc` event
    const releaseBtcEvents = pegoutsEvents.filter(
        (e) => e.signature === PEGOUT_EVENTS.RELEASE_BTC.signature
    );
    const latestReleaseBtcEvent = releaseBtcEvents.at(-1);
    expect(latestReleaseBtcEvent, 'release_btc event should be present').to.exist;

    const btcTx = bitcoinJsLib.Transaction.fromHex(
        removePrefix0x(latestReleaseBtcEvent.arguments.btcRawTransaction)
    );
    const btcTxId = btcTx.getId();

    // Gets the `pegout_transaction_created` event for the pegout tx in the `release_btc` event
    // to obtain the input amounts of the pegout tx and calculate the fee.
    const pegoutTxCreated = pegoutsEvents.find(
        (event) =>
            event.signature === PEGOUT_EVENTS.PEGOUT_TRANSACTION_CREATED.signature &&
            removePrefix0x(event.arguments.btcTxHash) === btcTxId
    );
    expect(
        pegoutTxCreated,
        'pegout_transaction_created for the release BTC tx should exist'
    ).to.exist;

    // Decode input amounts from `pegout_transaction_created.utxoOutpointValues` and sum them up
    // to get total input amount of the pegout tx.
    const encodedOutpointValues = Buffer.from(
        removePrefix0x(pegoutTxCreated.arguments.utxoOutpointValues),
        'hex'
    );
    const inputValues = decodeOutpointValues(encodedOutpointValues);

    const totalInputsSum = inputValues.reduce((acc, v) => acc + Number(v), 0);
    const totalOutputsSum = btcTx.outs.reduce((acc, o) => acc + o.value, 0);
    return totalInputsSum - totalOutputsSum;
};

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

    const getEstimatedFeesForPegOutAmountMethod = (satoshis) =>
        bridge.methods.getEstimatedFeesForPegOutAmount(satoshisToWeis(satoshis));

    const getEstimatedFeesForPegOutAmountCall = async (satoshis) =>
        Number(await getEstimatedFeesForPegOutAmountMethod(satoshis).call());

    const sendPegin = async (peginAmountInBtc) => {
        const peginBtcTxHash = await sendPeginToActiveFederation(
            rskTxHelper,
            btcTxHelper,
            senderInfo.btcSenderAddressInfo,
            peginAmountInBtc
        );
        await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);
    };

    const triggerReleaseAndAssertQueueCleared = async () => {
        await triggerRelease(rskTxHelpers, btcTxHelper);
        const countAfterRelease = await getQueuedPegoutsCount();
        const expectedPegoutRequestCountAfterRelease = 0;
        expect(countAfterRelease).to.equal(expectedPegoutRequestCountAfterRelease,
            `Number of pegout requests should be ${expectedPegoutRequestCountAfterRelease} in the queue after triggering release`
        );
    };

    const sendReleaseRequest = async (satoshisAmount) => await sendTxToBridge(
        rskTxHelper,
        new BN(satoshisToWeis(satoshisAmount)),
        senderInfo.rskRecipientRskAddressInfo.address
    );

    const assertEstimatedFeesEqualsActualFees = async (pegoutBlockNumber, estimatedFeesForNextPegOut) => {
        const blockNumberAfterPegoutRelease = await rskTxHelper.getBlockNumber();
        const pegoutsEvents = await getPegoutEventsInBlockRange(
            rskTxHelper,
            pegoutBlockNumber,
            blockNumberAfterPegoutRelease
        );
        const releaseTxFeeSatoshis = getReleaseBtcTransactionFeeInSatoshis(pegoutsEvents);
        expect(releaseTxFeeSatoshis).to.be.equals(
            estimatedFeesForNextPegOut,
            `estimated fees ${estimatedFeesForNextPegOut} should be equal to the actual fees ${releaseTxFeeSatoshis} of the pegout transaction in the release_btc event`
        );
    };

    const assertPegoutRequestsCount = async (expectedPegoutRequestsCount) => {
        const pegoutCount = await getQueuedPegoutsCount();
        expect(pegoutCount).to.equal(expectedPegoutRequestsCount, `Expected ${expectedPegoutRequestsCount} pegout requests to be in the queue but got ${pegoutCount}`);
    };

    const triggerReleaseAndAssertEstimatedFeesMatchActualFees = async (
        pegoutTxBlockNumber,
        expectedQueuedPegoutsCount,
        estimatedFees
    ) => {
        await assertPegoutRequestsCount(expectedQueuedPegoutsCount);
        await triggerReleaseAndAssertQueueCleared();
        await assertEstimatedFeesEqualsActualFees(pegoutTxBlockNumber, estimatedFees);
    };

    describe(description, () => {
        before(async () => {
            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            btcTxHelper = getBtcClient();
            bridge = await getBridge(rskTxHelper.getClient());

            const fundingAmountInBtc = 4;
            senderInfo = await createSenderRecipientInfo(
                rskTxHelper,
                btcTxHelper,
                'legacy',
                fundingAmountInBtc
            );

            const peginAmountInBtc = 2;
            await sendPegin(peginAmountInBtc);
        });

        beforeEach(async () => {
            await assertPegoutRequestsCount(0);
        });

        afterEach(async () => {
            await assertPegoutRequestsCount(0);
        });

        describe('getEstimatedFeesForNextPegOutEvent', () => {
            it('estimates the correct fee with no pegout requests queued', async () => {
                // Arrange & Act
                const estimatedFeesForNextPegOut = await getEstimatedFeesForNextPegOutEvent();

                // Assert
                const pegoutRequestTx = await sendReleaseRequest(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS);
                const numberOfPegoutRequestsExpected = 1;
                await triggerReleaseAndAssertEstimatedFeesMatchActualFees(pegoutRequestTx.blockNumber, numberOfPegoutRequestsExpected, estimatedFeesForNextPegOut);
            });

            it('estimates the correct fee with one pegout request queued', async () => {
                // Arrange
                const pegoutRequestTx = await sendReleaseRequest(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS);

                // Act
                const estimatedFeesForNextPegOut = await getEstimatedFeesForNextPegOutEvent();

                // Assert
                await sendReleaseRequest(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS);
                const numberOfPegoutRequestsExpected = 2;
                await triggerReleaseAndAssertEstimatedFeesMatchActualFees(pegoutRequestTx.blockNumber, numberOfPegoutRequestsExpected, estimatedFeesForNextPegOut);
            });
        });

        describe('getEstimatedFeesForPegOutAmount', () => {

            const PEGOUT_REQUEST_AMOUNT_IN_SATOSHIS = 500_000;

            it('estimates the correct fee with no pegout requests queued', async () => {
                // Arrange & Act
                const estimatedFeesForNextPegOut = await getEstimatedFeesForPegOutAmountCall(PEGOUT_REQUEST_AMOUNT_IN_SATOSHIS);

                // Assert
                const pegoutRequestTx = await sendReleaseRequest(PEGOUT_REQUEST_AMOUNT_IN_SATOSHIS);
                const numberOfPegoutRequestsExpected = 1;
                await triggerReleaseAndAssertEstimatedFeesMatchActualFees(pegoutRequestTx.blockNumber, numberOfPegoutRequestsExpected, estimatedFeesForNextPegOut);
            });

            it('estimates the correct fee with one pegout request queued', async () => {
                // Arrange
                const pegoutRequestTx = await sendReleaseRequest(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS);

                // Act
                const estimatedFeesForNextPegOut = await getEstimatedFeesForPegOutAmountCall(PEGOUT_REQUEST_AMOUNT_IN_SATOSHIS);

                // Assert
                await sendReleaseRequest(PEGOUT_REQUEST_AMOUNT_IN_SATOSHIS);
                const numberOfPegoutRequestsExpected = 2;
                await triggerReleaseAndAssertEstimatedFeesMatchActualFees(pegoutRequestTx.blockNumber, numberOfPegoutRequestsExpected, estimatedFeesForNextPegOut);
            });

            it('should revert when pegout amount is below minimum pegout', async () => {
                await assertContractCallFails(
                    getEstimatedFeesForPegOutAmountMethod(MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS - 1)
                );
            });
        });
    });
};

module.exports = {
    execute,
};
