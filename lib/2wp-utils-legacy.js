const expect = require('chai').expect;
const rsk = require('peglib').rsk;
const rskUtilsLegacy = require('./rsk-utils-legacy');
const { wait, retryWithCheck } = require('./utils');
const { createPeginV1TxData } = require('./2wp-utils');
const { getBridge, getLatestActiveForkName } = require('./precompiled-abi-forks-util');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');

const BTC_TO_RSK_MINIMUM_CONFIRMATIONS = 3;
const MINIMUM_PEGIN_VALUE_IN_BTC = 1;

const assertEventFound = (rskClient) => async(eventName, callback, callBackParams, maxPastBlocksToCheck) => {
    let eventFound = await rskUtilsLegacy.getBridgeEventAndRunAssertions(
        eventName, 
        callback(callBackParams), 
        rsk,
        maxPastBlocksToCheck
    );

    if (!eventFound) {
        throw new Error(`Event ${eventName} not found`);
    }
}

const peginRejectionCallback = (callBackParams) => (decodedLog) => {
    let peginTxHash = callBackParams.peginTxHash;
    let expectedErrorCode = callBackParams.expectedErrorCode;
    expect(decodedLog[0]).to.be.equals('0x' + peginTxHash);
    expect(parseInt(decodedLog[1])).to.be.equal(expectedErrorCode);
}

const releaseRequestedCallback = (callBackParams) => (decodedLog) => {
    let rskTxHash = callBackParams.rskTxHash;
    let minExpectedValue = callBackParams.minExpectedValue;
    expect(decodedLog[0]).to.be.equals(rskTxHash);
    expect(decodedLog[1]).to.not.be.undefined; //This may not be necessary
    expect(parseInt(decodedLog[2])).to.be.at.least(parseInt(minExpectedValue));
}

const assertRefundUtxosSameAsPeginUtxos = (btcClient, rskClient) =>  async(peginTxHash, refundAddress) => {
    const latestActiveForkName = await getLatestActiveForkName();
    const bridge = getBridge(rskClient, latestActiveForkName);
    const federationAddress = await bridge.methods.getFederationAddress().call();
    let peginTx = await btcClient.getTransaction(peginTxHash);
    let outputsForFederation = peginTx.outs.filter(output => btcClient.getOutputAddress(output.script) == federationAddress);
    let refundAddressUtxos = await btcClient.nodeClient.getUtxos(refundAddress);
    expect(refundAddressUtxos.length).to.equal(outputsForFederation.length);

    let refundTxHash = refundAddressUtxos[0].txid;
    let refundTx = await btcClient.getTransaction(refundTxHash);
    expect(refundTx.ins.length).to.equal(outputsForFederation.length);
    
    refundTx.ins.forEach((input) => {
        let inputHash = input.hash.reverse().toString('hex');
        expect(inputHash).to.equal(peginTxHash);
    });
}

const sendTxToBridge = (rskClient) => async(senderAddress, valueInWeis) => {
    const TO_BRIDGE_GAS_PRICE = 2;

    return await rskClient.rsk.sendTx({
        from: senderAddress,
        to: rsk.getBridgeAddress(),
        value: valueInWeis,
        gasPrice: TO_BRIDGE_GAS_PRICE
    }, rskClient.evm.mine);
}

const sendTxToBridgeWithoutMining = (rskClient) => async (senderAddress, valueInWeis) => {

    return new Promise((resolve, reject) => {
        const sendResult = rskClient.eth.sendTransaction({
            from: senderAddress,
            to: rsk.getBridgeAddress(),
            value: valueInWeis,
            gasPrice: 2
        });

        sendResult.catch((err) => reject(err));
        sendResult.once('transactionHash', (txHash) => {
            resolve(txHash);
        });
    })
}

const createPegoutRequest = async (rskClient, pegClient, amountInRBTC, requestSize = 1) => {
    const AMOUNT_IN_WEIS = rsk.btcToWeis(amountInRBTC);
    const RSK_TX_FEE_IN_WEIS = rsk.btcToWeis(1);
    const PEGOUT_AMOUNT_PLUS_FEE = (AMOUNT_IN_WEIS + RSK_TX_FEE_IN_WEIS) * requestSize;

    const addresses = await pegClient.generateNewAddress('test');
    expect(addresses.inRSK).to.be.true;
    const utils = rskUtilsLegacy.with(null, rskClient, null);
    await utils.sendFromCow(addresses.rsk, PEGOUT_AMOUNT_PLUS_FEE);
    await rskClient.eth.personal.unlockAccount(addresses.rsk, '');

    const sendTxToBridgeFunction = sendTxToBridgeWithoutMining(rskClient);
    for (let i = 0; i < requestSize; i++) {
        await sendTxToBridgeFunction(addresses.rsk, AMOUNT_IN_WEIS);
    }
    await rskClient.evm.mine()
}

/**
 * 
 * @param {object} rskClient
 * @param {string} peginTxHash to be found in the bridge's utxo list
 * @returns {boolean} returns a boolean value indicating if the pegin was found in the bridge or not
 */
const isUtxoRegisteredInBridge = async (rskClient, peginTxHash, expectedUxtosCount) => {
    const bridgeState = await getBridgeState(rskClient);
    return bridgeState.activeFederationUtxos
        .filter(utxo =>  utxo.btcTxHash === peginTxHash).length === expectedUxtosCount;
};

/**
 * Simply sends funds to the federation and mines the required btc blocks for the pegin to go through,
 * updates the bridge and mines 1 rsk block for the changes to take effect.
 * @param {Web3} rskClient
 * @param {BtcTransactionHelper} btcClient
 * @param {object} btcSenderAddressInformation the btc object information that contains the btc address and private key to spend funds from
 * @param {Array<number> | number} outputAmountsInBtc the pegin amounts to send to the bridge in btc. If only one amount is sent, it will be converted to an array.
 * @param {Array<string>} data for pegin v1 script
 */
const sendPegin = async (rskClient, btcClient, btcSenderAddressInformation, outputAmountsInBtc, data) => {

    if (!Array.isArray(outputAmountsInBtc)) {
        outputAmountsInBtc = Array.of(outputAmountsInBtc);
    }

    const latestActiveForkName = await getLatestActiveForkName();
    const bridge = getBridge(rskClient, latestActiveForkName);
    const federationAddress = await bridge.methods.getFederationAddress().call();

    const recipientsTransferInformation = outputAmountsInBtc.map(amount => ({ recipientAddress: federationAddress, amountInBtc: amount }));

    const peginBtcTxHash = await btcClient.transferBtc(btcSenderAddressInformation, recipientsTransferInformation, data);
    
    await btcClient.mine(BTC_TO_RSK_MINIMUM_CONFIRMATIONS);
    await waitAndUpdateBridge(rskClient, 500);

    return peginBtcTxHash;

};

/**
 * Ensures that the pegin with btc hash `peginBtcTxHash` is registered in the bridge, mining and waiting, trying to find
 * multiple times. If it's not found after the maximum attempt, throws an exception.
 * @param {Web3} rskClient
 * @param {string} peginBtcTxHash
 */
const ensurePeginIsRegistered = async (rskClient, peginBtcTxHash, expectedUxtosCount = 1) => {

    const MAX_ATTEMPTS = 20;
    const CHECK_EVERY_MILLISECONDS = 3000;

    const method = async () => { 
        return isUtxoRegisteredInBridge(rskClient, peginBtcTxHash, expectedUxtosCount) 
    };

    const check = async (utxoIsRegistered, currentAttempts) => {
        console.debug(`Attempting to find the pegin ${peginBtcTxHash} in the bridge. Attempt ${currentAttempts} out of ${MAX_ATTEMPTS}`);
        if(!utxoIsRegistered) {
            await waitAndUpdateBridge(rskClient, 1000);
        }
        return utxoIsRegistered;
    };

    const utxoIsRegisteredInTheBridge = await retryWithCheck(method, check, MAX_ATTEMPTS, CHECK_EVERY_MILLISECONDS);
    
    if(utxoIsRegisteredInTheBridge) {
        console.debug(`Found pegin ${peginBtcTxHash} registered in the bridge.`);
        // The pegin is already registered in the bridge, but the balance may still not be reflected on the user's rsk address
        // So we need to update the bridge and mine one more block so the balance is reflected on the user's rsk address
        await waitAndUpdateBridge(rskClient);
        return;
     }

    throw new Error(`Could not find the pegin registered in the bridge after ${MAX_ATTEMPTS} attempts`);
  
};

/**
 * 
 * @param {Web3} rskClient 
 * @param {number} timeInMilliseconds defaults to 1000
 */
const waitAndUpdateBridge = async (rskClient, timeInMilliseconds = 1000) => {
    await wait(timeInMilliseconds);
    await rskClient.fed.updateBridge();
    await rskClient.evm.mine();
};

/**
 * Sends a pegin donation to the bridge
 * @param {peglib.rsk.rskClient} rskClient 
 * @param {BtcTransactionHelper} btcClient 
 * @param {number} amountInBtc 
 * @returns {string} the pegin tx hash
 */
const donateToBridge = async (rskClient, btcClient, donatingBtcAddressInformation, amountInBtc) => {
    const data = [];
    data.push(createPeginV1TxData(rsk.getBridgeAddress()));
    const peginBtcTxHash = await sendPegin(rskClient, btcClient, donatingBtcAddressInformation, amountInBtc, data);
    await ensurePeginIsRegistered(rskClient, peginBtcTxHash);
    return peginBtcTxHash;
};

const releaseRequestReceivedCallback = (callBackParams) => async (decodedLog) => {
    let rskAddress = callBackParams.rskAddress;
    let value = callBackParams.value;
    expect(decodedLog[0].toLowerCase()).to.be.equals(rskAddress);
    const btcRecipientAddress = decodedLog[1];
    expect(btcRecipientAddress).to.not.be.undefined; //btcDestinationAddress

    const isFingerroot500Active = Runners.common.forks.fingerroot500.isAlreadyActive();
    if(isFingerroot500Active) {
      expect(btcRecipientAddress.startsWith("m") || btcRecipientAddress.startsWith("n")).to.be.true; // btcRecipientAddress in base58 format
    } else {
      expect(btcRecipientAddress.startsWith("0x")).to.be.true; // btcRecipientAddress in hash160 format
    }

    expect(parseInt(decodedLog[2])).to.be.at.least(parseInt(value));
};

module.exports = {
    with: (btcClient, rskClient) => ({
        assertEventFound: assertEventFound(rskClient),
        assertRefundUtxosSameAsPeginUtxos: assertRefundUtxosSameAsPeginUtxos(btcClient, rskClient),
        sendTxToBridge: sendTxToBridge(rskClient)
    }),
    peginRejectionCallback,
    releaseRequestReceivedCallback,
    releaseRequestedCallback,
    createPegoutRequest,
    sendPegin,
    ensurePeginIsRegistered,
    isUtxoRegisteredInBridge,
    donateToBridge,
    BTC_TO_RSK_MINIMUM_CONFIRMATIONS,
    MINIMUM_PEGIN_VALUE_IN_BTC,
};
