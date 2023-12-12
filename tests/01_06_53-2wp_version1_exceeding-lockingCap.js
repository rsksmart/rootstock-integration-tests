const { expect } = require('chai');
const rskUtils = require('../lib/rsk-utils');
const { createPeginV1TxData, sendPegin, assertRefundUtxosSameAsPeginUtxos } = require('../lib/2wp-utils');
const { getBridge , getLatestActiveForkName} = require('../lib/precompiled-abi-forks-util');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { ensure0x } = require('../lib/utils');
const { 
    PEGIN_REJECTION_REASONS: { PEGIN_CAP_SURPASSED_REASON }
 } = require('../lib/constants');

const AMOUNT_TO_LOCK_IN_BTC = 2;

let lockingCapInBtc
let btcTxHelper;
let rskTxHelper;
let rskTxHelpers;

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
    await rskUtils.activateFork(Runners.common.forks.fingerroot500);
};

describe('Lock funds using peg-in protocol version 1', () => {
    before(async () => {

        btcTxHelper = getBtcClient();
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile();
        }

        const latestActiveForkName = await getLatestActiveForkName();
        const bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);

        // Get the current locking cap
        lockingCapInBtc = Number(btcEthUnitConverter.satoshisToBtc(Number(await bridge.methods.getLockingCap().call())));

    });

    it('should refund to indicated address when locking cap exceeded using bech32 sender', async () => {

        const senderAddressInformation = await btcTxHelper.generateBtcAddress('bech32');
        const initialSenderBalance = await btcTxHelper.getAddressBalance(senderAddressInformation.address);

        // Create RSK destination address
        const privateKey = (await btcTxHelper.generateBtcAddress('legacy')).privateKey;
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(privateKey, btcTxHelper.btcConfig.network);
        const rskDestinationAddress = recipientRskAddressInfo.address;
        const initialDestinationAddressBalance = await rskTxHelper.getBalance(rskDestinationAddress);

        // Create legacy type address to use as refund
        const refundAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
        const initialRefundAddressBalance = await btcTxHelper.getAddressBalance(refundAddressInformation.address);

        // Create peg-in data
        const data = [];
        data.push(createPeginV1TxData(rskDestinationAddress, refundAddressInformation.address));

        // Execute peg-in
        const AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP = AMOUNT_TO_LOCK_IN_BTC + lockingCapInBtc;
        await btcTxHelper.fundAddress(senderAddressInformation.address, AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP + btcTxHelper.getFee());

        const searchRejectedPeginEventFromBlock = await rskTxHelper.getBlockNumber();

        const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInformation, AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP, data);

        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        // Assert
        const finalSenderBalance = await btcTxHelper.getAddressBalance(senderAddressInformation.address);
        const finalDestinationAddressBalance = await rskTxHelper.getBalance(rskDestinationAddress);
        const finalRefundAddressBalance = await btcTxHelper.getAddressBalance(refundAddressInformation.address);
        const refundAddressBalanceDifference = AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP - Number(finalRefundAddressBalance);

        expect(Number(initialSenderBalance)).to.equal(0);
        expect(Number(finalSenderBalance)).to.equal(0);
        expect(Number(initialDestinationAddressBalance)).to.equal(0);
        expect(Number(finalDestinationAddressBalance)).to.equal(0);
        expect(Number(initialRefundAddressBalance)).to.equal(0);
        expect(refundAddressBalanceDifference).to.be.at.most(btcTxHelper.getFee());

        // Check the same UTXOs used for the peg-in tx were used for the reject tx
        await assertRefundUtxosSameAsPeginUtxos(rskTxHelper, btcTxHelper, peginBtcTxHash, refundAddressInformation.address);

        const peginBtcTxHashWith0xPrefix = ensure0x(peginBtcTxHash);

        const latestBlock = await rskTxHelper.getBlockNumber();

        const rejectedPeginEvent = await rskUtils.findEventInBlock(rskTxHelper, 'rejected_pegin', searchRejectedPeginEventFromBlock, latestBlock, (event) => {
            return event.arguments.btcTxHash === peginBtcTxHashWith0xPrefix;
        });

        expect(rejectedPeginEvent).to.not.be.null;
        expect(rejectedPeginEvent.arguments.reason).to.equal(PEGIN_CAP_SURPASSED_REASON);

    });

    it('should refund to sender address when locking cap exceeded using p2pkh sender and no refund address', async () => {
        // Create p2pkh type address to use as sender
        const senderAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
        const initialSenderBalance = await btcTxHelper.getAddressBalance(senderAddressInformation.address);

        // Execute peg-in
        const AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP = AMOUNT_TO_LOCK_IN_BTC + lockingCapInBtc;
        await btcTxHelper.fundAddress(senderAddressInformation.address, AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP + btcTxHelper.getFee());

        const searchRejectedPeginEventFromBlock = await rskTxHelper.getBlockNumber();

        const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInformation, AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP, null);
        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        // Assert
        const finalSenderBalance = await btcTxHelper.getAddressBalance(senderAddressInformation.address);
        const senderBalanceDifference = AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP - Number(finalSenderBalance);

        expect(Number(initialSenderBalance)).to.equal(0);
        expect(Number(senderBalanceDifference)).to.be.at.most(btcTxHelper.getFee());

        // Check the same UTXOs used for the peg-in tx were used for the reject tx
        await assertRefundUtxosSameAsPeginUtxos(rskTxHelper, btcTxHelper, peginBtcTxHash, senderAddressInformation.address);

        const latestBlock = await rskTxHelper.getBlockNumber();

        const peginBtcTxHashWith0xPrefix = ensure0x(peginBtcTxHash);

        const rejectedPeginEvent = await rskUtils.findEventInBlock(rskTxHelper, 'rejected_pegin', searchRejectedPeginEventFromBlock, latestBlock, (event) => {
            return event.arguments.btcTxHash === peginBtcTxHashWith0xPrefix;
        });

        expect(rejectedPeginEvent).to.not.be.null;
        expect(rejectedPeginEvent.arguments.btcTxHash).to.equal(peginBtcTxHashWith0xPrefix);
        expect(rejectedPeginEvent.arguments.reason).to.equal(PEGIN_CAP_SURPASSED_REASON);

    });

    it('should refund to sender address when locking cap exceeded using p2pkh sender with OP_RETURN and no refund address', async () => {
        // Create p2pkh type address to use as sender
        const senderAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
        const initialSenderBalance = await btcTxHelper.getAddressBalance(senderAddressInformation.address);

        // Create RSK destination address
        const privateKey = (await btcTxHelper.generateBtcAddress('legacy')).privateKey;
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(privateKey, btcTxHelper.btcConfig.network);
        const rskDestinationAddress = recipientRskAddressInfo.address;
        const initialDestinationAddressBalance = await rskTxHelper.getBalance(rskDestinationAddress);


        // Create peg-in data
        const data = [];
        data.push(createPeginV1TxData(rskDestinationAddress));

        // Execute peg-in
        const AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP = AMOUNT_TO_LOCK_IN_BTC + lockingCapInBtc;

        await btcTxHelper.fundAddress(senderAddressInformation.address, AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP + btcTxHelper.getFee());

        const searchRejectedPeginEventFromBlock = await rskTxHelper.getBlockNumber();

        const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInformation, AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP, data);
        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        // Assert
        const finalSenderBalance = await btcTxHelper.getAddressBalance(senderAddressInformation.address);
        const finalDestinationAddressBalance = await rskTxHelper.getBalance(rskDestinationAddress);
        const senderBalanceDifference = AMOUNT_TO_LOCK_EXCEEDING_LOCKING_CAP - Number(finalSenderBalance);

        expect(Number(initialSenderBalance)).to.equal(0);
        expect(Number(senderBalanceDifference)).to.be.at.most(btcTxHelper.getFee());
        expect(Number(initialDestinationAddressBalance)).to.equal(0);
        expect(Number(finalDestinationAddressBalance)).to.equal(0);

        // Check the same UTXOs used for the peg-in tx were used for the reject tx
        await assertRefundUtxosSameAsPeginUtxos(rskTxHelper, btcTxHelper, peginBtcTxHash, senderAddressInformation.address);

        const latestBlock = await rskTxHelper.getBlockNumber();

        const peginBtcTxHashWith0xPrefix = ensure0x(peginBtcTxHash);

        const rejectedPeginEvent = await rskUtils.findEventInBlock(rskTxHelper, 'rejected_pegin', searchRejectedPeginEventFromBlock, latestBlock, (event) => {
            return event.arguments.btcTxHash === peginBtcTxHashWith0xPrefix;
        });

        expect(rejectedPeginEvent).to.not.be.null;
        expect(rejectedPeginEvent.arguments.btcTxHash).to.equal(peginBtcTxHashWith0xPrefix);
        expect(rejectedPeginEvent.arguments.reason).to.equal(PEGIN_CAP_SURPASSED_REASON);

    });

});
