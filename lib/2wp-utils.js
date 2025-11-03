const expect = require('chai').expect;
const { 
    sendFromCow, 
    mineAndSync, 
    sendTxWithCheck, 
    getUnlockedAddress, 
    waitForRskMempoolToGetNewTxs, 
    waitAndUpdateBridge 
} = require('./rsk-utils');
const BN = require('bn.js');
const { retryWithCheck, ensure0x } = require('./utils');
const { waitForBitcoinTxToBeInMempool, waitForBitcoinMempoolToGetTxs, getBtcAddressBalanceInSatoshis } = require('./btc-utils');
const { getBridge } = require('./bridge-provider');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { PEGIN_EVENTS, DEFAULT_RSK_ADDRESS_FUNDING_IN_BTC } = require('./constants/pegin-constants');
const { PEGOUT_EVENTS } = require('./constants/pegout-constants');

const peginVerifier = require('pegin-address-verificator');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR} = require('../lib/assertions/whitelisting');
const { getLogger } = require('../logger');

const {
    oldFederationBtcUTXOSStorageIndex,
    newFederationBtcUTXOSStorageIndex
} = require('./constants/federation-constants');
const { parseRLPToActiveFederationUtxos } = require('@rsksmart/bridge-state-data-parser/active-federation-utxos');

const BTC_TO_RSK_MINIMUM_CONFIRMATIONS = 3;
const TO_BRIDGE_GAS_PRICE = 2;
const BRIDGE_ADDRESS = '0x0000000000000000000000000000000001000006';
const MIN_PEGOUT_VALUE_IN_RBTC = 0.0025;

const logger = getLogger();

/**
 * 
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {BtcTransactionHelper} btcTxHelper 
 * @param {string} peginTxHash 
 * @param {string} refundAddress 
 */
const assertRefundUtxosSameAsPeginUtxos = async(rskTxHelper, btcTxHelper, peginTxHash, refundAddress) => {
    const bridge = await getBridge(rskTxHelper.getClient());
    const federationAddress = await bridge.methods.getFederationAddress().call();
    const peginTx = await btcTxHelper.getTransaction(peginTxHash);
    const outputsForFederation = peginTx.outs.filter(output => btcTxHelper.getOutputAddress(output.script) === federationAddress);
    const refundAddressUtxos = await btcTxHelper.getUtxos(refundAddress);
    expect(refundAddressUtxos.length).to.equal(outputsForFederation.length);

    const refundTxHash = refundAddressUtxos[0].txid;
    const refundTx = await btcTxHelper.getTransaction(refundTxHash);
    expect(refundTx.ins.length).to.equal(outputsForFederation.length);
    
    for (const input of refundTx.ins) {
        const inputHash = input.hash.reverse().toString('hex');
        expect(inputHash).to.equal(peginTxHash);
    }
};

/**
 * Sends a tx to the bridge
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {BN} amountInWeisBN 
 * @param {string} rskFromAddress 
 * @param {boolean} mine If true, mines 1 block after sending the transaction. If false, it will not mine the tx and will return undefined. Defaults to true.
 * @returns {Promise<web3.eth.TransactionReceipt | txPromise>} the rsk tx receipt if `mine` is true, otherwise the tx promise.
 */
const sendTxToBridge = async (rskTxHelper, amountInWeisBN, rskFromAddress, mine = true) => {

    const txPromise = rskTxHelper.sendTransaction({
      from: rskFromAddress,
      to: BRIDGE_ADDRESS,
      value: amountInWeisBN,
      gasPrice: TO_BRIDGE_GAS_PRICE,
    });

    if(!mine) {
        return txPromise;
    }

    // Wait for the rsk tx to be in the rsk mempool before mining
    await waitForRskMempoolToGetNewTxs(rskTxHelper);

    await mineAndSync(getRskTransactionHelpers());
    const result = await txPromise;
    return result;
    
};

/**
 * 
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {BtcTransactionHelper} btcTxHelper 
 * @param {number} amountInRBTC 
 * @param {number} requestSize 
 * @returns {Promise<string>} the rsk tx hash that mined the pegout request
 */
const createPegoutRequest = async (rskTxHelper, amountInRBTC, requestSize = 1) => {
    const AMOUNT_IN_WEIS = Number(btcEthUnitConverter.btcToWeis(amountInRBTC));
    const RSK_TX_FEE_IN_WEIS = Number(btcEthUnitConverter.btcToWeis(1));
    const PEGOUT_AMOUNT_PLUS_FEE = (AMOUNT_IN_WEIS + RSK_TX_FEE_IN_WEIS) * requestSize;
    const rskAddress = await rskTxHelper.newAccountWithSeed('test');
    await sendFromCow(rskTxHelper, rskAddress, PEGOUT_AMOUNT_PLUS_FEE);
    await rskTxHelper.unlockAccount(rskAddress);
    for (let i = 0; i < requestSize; i++) {
        await sendTxToBridge(rskTxHelper, new BN(ethToWeis(amountInRBTC)), rskAddress, false);
    }
    await mineAndSync(getRskTransactionHelpers());
};

const getActiveFederationUtxos = async (rskTxHelper) => {
    const activeUtxosRlpEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, newFederationBtcUTXOSStorageIndex);
    if(activeUtxosRlpEncoded !== '0x0') {
        return parseRLPToActiveFederationUtxos(activeUtxosRlpEncoded);
    }
    return [];
};

const getOldFederationUtxos = async (rskTxHelper) => {
    const oldUtxosRlpEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, oldFederationBtcUTXOSStorageIndex);
    if(oldUtxosRlpEncoded !== '0x0') {
        return parseRLPToActiveFederationUtxos(oldUtxosRlpEncoded);
    }
    return [];
};

/**
 * Checks if the an utxo with the specified pegin btc tx hash is registered in the bridge
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} peginTxHash to be found in the bridge's utxo list
 * @returns {boolean} returns a boolean value indicating if the pegin was found in the bridge or not
 */
const isUtxoRegisteredInBridge = async (rskTxHelper, peginTxHash, expectedUxtosCount = 1) => {
    const activeFederationUtxos = await getActiveFederationUtxos(rskTxHelper);
    const oldFederationUtxos = await getOldFederationUtxos(rskTxHelper);
    const totalUtxos = [...activeFederationUtxos, ...oldFederationUtxos];
    return totalUtxos
        .filter(utxo =>  utxo.btcTxHash === peginTxHash).length === expectedUxtosCount;
};

const mineForPeginRegistration = async (rskTxHelper, btcTxHelper) => {
    // Enough confirmations to register the coinbase but not the pegin.
    // Wait for the pegin to be in the bitcoin mempool before mining
    await waitForBitcoinMempoolToGetTxs(btcTxHelper);
    await btcTxHelper.mine(BTC_TO_RSK_MINIMUM_CONFIRMATIONS - 1);
    await waitAndUpdateBridge(rskTxHelper, 500);
    // One more confirmation to register the pegin.
    // Wait for the pegin to be in the bitcoin mempool before mining
    await waitForBitcoinMempoolToGetTxs(btcTxHelper);
    await btcTxHelper.mine(1);
    await waitAndUpdateBridge(rskTxHelper, 500);
};

/**
 * Simply sends funds to the federation and mines the required btc blocks for the pegin to go through,
 * updates the bridge and mines 1 rsk block for the changes to take effect.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {string} federationAddress the federation address to send the funds to
 * @param {object} btcSenderAddressInformation the btc object information that contains the btc address and private key to spend funds from
 * @param {Array<number> | number} outputAmountsInBtc the pegin amounts to send to the bridge in btc. If only one amount is sent, it will be converted to an array.
 * @param {Array<string>} data for pegin v1 script
 * @returns {Promise<string>} the pegin btc tx hash
 */
const sendPegin = async (rskTxHelper, btcTxHelper, federationAddress, btcSenderAddressInformation, outputAmountsInBtc, data) => {

    if (!Array.isArray(outputAmountsInBtc)) {
        outputAmountsInBtc = Array.of(outputAmountsInBtc);
    }

    const recipientsTransferInformation = outputAmountsInBtc.map(amount => ({ recipientAddress: federationAddress, amountInBtc: amount }));

    const peginBtcTxHash = await btcTxHelper.transferBtc(btcSenderAddressInformation, recipientsTransferInformation, data);
    
    // Wait for the pegin to be in the bitcoin mempool before mining
    await waitForBitcoinTxToBeInMempool(btcTxHelper, peginBtcTxHash);

    await mineForPeginRegistration(rskTxHelper, btcTxHelper);

    return peginBtcTxHash;

};

const sendPeginToActiveAndRetiringFederations = async (rskTxHelper, btcTxHelper, btcSenderAddressInformation, outputAmountsInBtcForActiveFederation, outputAmountsInBtcForRetiringFederation, data) => {
    
    if (!Array.isArray(outputAmountsInBtcForActiveFederation)) {
        outputAmountsInBtcForActiveFederation = Array.of(outputAmountsInBtcForActiveFederation);
    }

    if (!Array.isArray(outputAmountsInBtcForRetiringFederation)) {
        outputAmountsInBtcForRetiringFederation = Array.of(outputAmountsInBtcForRetiringFederation);
    }

    const bridge = await getBridge(rskTxHelper.getClient());
    const federationAddress = await bridge.methods.getFederationAddress().call();
    const retiringFederationAddress = await bridge.methods.getRetiringFederationAddress().call();

    const recipientsTransferInformation = outputAmountsInBtcForActiveFederation.map(amount => ({ recipientAddress: federationAddress, amountInBtc: Number(amount) }));
    const recipientsTransferInformationRetiring = outputAmountsInBtcForRetiringFederation.map(amount => ({ recipientAddress: retiringFederationAddress, amountInBtc: Number(amount) }));

    const outputs = [...recipientsTransferInformation, ...recipientsTransferInformationRetiring];

    const peginBtcTxHash = await btcTxHelper.transferBtc(btcSenderAddressInformation, outputs, data);
    
    // Wait for the pegin to be in the bitcoin mempool before mining
    await waitForBitcoinTxToBeInMempool(btcTxHelper, peginBtcTxHash);

    await mineForPeginRegistration(rskTxHelper, btcTxHelper);

    return peginBtcTxHash;

};

/**
 * Simply sends funds to the active federation and mines the required btc blocks for the pegin to go through,
 * updates the bridge and mines 1 rsk block for the changes to take effect.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {object} btcSenderAddressInformation the btc object information that contains the btc address and private key to spend funds from
 * @param {Array<number> | number} outputAmountsInBtc the pegin amounts to send to the bridge in btc. If only one amount is sent, it will be converted to an array.
 * @param {Array<string>} data for pegin v1 script
 * @returns {Promise<string>} the pegin btc tx hash
 */
const sendPeginToActiveFederation = async (rskTxHelper, btcTxHelper, btcSenderAddressInformation, outputAmountsInBtc, data) => {

    const bridge = await getBridge(rskTxHelper.getClient());
    const federationAddress = await bridge.methods.getFederationAddress().call();
    return await sendPegin(rskTxHelper, btcTxHelper, federationAddress, btcSenderAddressInformation, outputAmountsInBtc, data);

};

/**
 * Simply sends funds to the retiring federation and mines the required btc blocks for the pegin to go through,
 * updates the bridge and mines 1 rsk block for the changes to take effect.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {object} btcSenderAddressInformation the btc object information that contains the btc address and private key to spend funds from
 * @param {Array<number> | number} outputAmountsInBtc the pegin amounts to send to the bridge in btc. If only one amount is sent, it will be converted to an array.
 * @param {Array<string>} data for pegin v1 script
 * @returns {Promise<string>} the pegin btc tx hash
 */
const sendPeginToRetiringFederation = async (rskTxHelper, btcTxHelper, btcSenderAddressInformation, outputAmountsInBtc, data) => {

    const bridge = await getBridge(rskTxHelper.getClient());
    const retiringFederationAddress = await bridge.methods.getRetiringFederationAddress().call();
    return await sendPegin(rskTxHelper, btcTxHelper, retiringFederationAddress, btcSenderAddressInformation, outputAmountsInBtc, data);

};

/**
 * Ensures that the pegin with btc hash `peginBtcTxHash` is registered in the bridge, mining and waiting, trying to find
 * multiple times. If it's not found after the maximum attempt, throws an exception.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} peginBtcTxHash
 * @param {number} expectedUtxosCount the expected number of utxos with the same pegin tx hash
 * @returns {Promise<void>} throws an exception if the pegin is not found in the bridge after the maximum attempts
 */
const ensurePeginIsRegistered = async (rskTxHelper, peginBtcTxHash, expectedUtxosCount = 1) => {

    const MAX_ATTEMPTS = 20;
    const CHECK_EVERY_MILLISECONDS = 3000;

    const method = async () => { 
        return isUtxoRegisteredInBridge(rskTxHelper, peginBtcTxHash, expectedUtxosCount) 
    };

    const check = async (utxoIsRegistered, currentAttempts) => {
        logger.debug(`[${ensurePeginIsRegistered.name}::${check.name}] Attempting to find the pegin ${peginBtcTxHash} in the bridge. Attempt ${currentAttempts} out of ${MAX_ATTEMPTS}`);
        if(!utxoIsRegistered) {
            await waitAndUpdateBridge(rskTxHelper, 1000);
        }
        return utxoIsRegistered;
    };

    const { result: utxoIsRegisteredInTheBridge } = await retryWithCheck(method, check, MAX_ATTEMPTS, CHECK_EVERY_MILLISECONDS);
    
    const bridge = await getBridge(rskTxHelper.getClient())
    const isBtcTxHashAlreadyProcessed = await bridge.methods.isBtcTxHashAlreadyProcessed(peginBtcTxHash).call();
    
    if(utxoIsRegisteredInTheBridge && isBtcTxHashAlreadyProcessed) {
        logger.debug(`[${ensurePeginIsRegistered.name}] Found pegin ${peginBtcTxHash} registered in the bridge.`);
        // The pegin is already registered in the bridge, but the balance may still not be reflected on the user's rsk address
        // So we need to update the bridge and mine one more block so the balance is reflected on the user's rsk address
        await waitAndUpdateBridge(rskTxHelper);
        return;
     }

    throw new Error(`Could not find the pegin registered in the bridge after ${MAX_ATTEMPTS} attempts`);
  
};

/**
 * Sends a pegin donation to the bridge
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {BtcTransactionHelper} btcTxHelper 
 * @param {number} amountInBtc 
 * @returns {Promise<string>} the pegin tx hash
 */
const donateToBridge = async (rskTxHelper, btcTxHelper, donatingBtcAddressInformation, amountInBtc) => {
    const data = [];
    data.push(Buffer.from(peginVerifier.createPeginV1TxData(BRIDGE_ADDRESS), 'hex'));
    const peginBtcTxHash = await sendPeginToActiveFederation(rskTxHelper, btcTxHelper, donatingBtcAddressInformation, amountInBtc, data);
    await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);
    return peginBtcTxHash;
};

/**
 * Disable the whitelisting in the bridge and mine the required blocks specified in the blockDelay parameter.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {BtcTransactionHelper} btcTxHelper 
 * @param {number} blockDelay defaults to 1. If a 0 or negative number is passed, then it will not mine. If a number greater than 0 is passed, it will mine the specified number of blocks.
 * @returns {Promise<void>}
 */
const disableWhitelisting = async (rskTxHelper, btcTxHelper, blockDelay = 1) => {
    const bridge = await getBridge(rskTxHelper.getClient());
    const unlocked = await getUnlockedAddress(rskTxHelper, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);
    expect(unlocked).to.be.true;
    const disableLockWhitelistMethod = bridge.methods.setLockWhitelistDisableBlockDelay(blockDelay);
    const disableResultCallback = (disableResult) => expect(Number(disableResult)).to.equal(1);
    await sendTxWithCheck(rskTxHelper, disableLockWhitelistMethod, WHITELIST_CHANGE_ADDR, disableResultCallback);
    if(blockDelay > 0) {
      await btcTxHelper.mine(blockDelay);
    }
};

/**
 * Creates a btc sender and rsk recipient information (private keys and addresses) and funds the btc sender address with the specified amount.
 * @param {RskTransactionHelper} rskTxHelper to make transactions to the rsk network.
 * @param {BtcTransactionHelper} btcTxHelper to make transactions to the bitcoin network.
 * @param {string} type the btc address type to generate. Defaults to 'legacy'.
 * @param {number} initialAmountToFundInBtc the initial amount to fund the btc sender address. Defaults to 1.
 * @returns {Promise<{btcSenderAddressInfo: {address: string, privateKey: string}, rskRecipientRskAddressInfo: {address: string, privateKey: string}>}}
 */
const createSenderRecipientInfo = async (rskTxHelper, btcTxHelper, type = 'legacy', initialAmountToFundInBtc = 1) => {
    const btcSenderAddressInfo = await btcTxHelper.generateBtcAddress(type);
    const rskRecipientRskAddressInfo = getDerivedRSKAddressInformation(btcSenderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
    await rskTxHelper.importAccount(rskRecipientRskAddressInfo.privateKey);
    await rskTxHelper.unlockAccount(rskRecipientRskAddressInfo.address);
    if(Number(initialAmountToFundInBtc) > 0) {
        await btcTxHelper.fundAddress(btcSenderAddressInfo.address, initialAmountToFundInBtc);
    }
    return {
        btcSenderAddressInfo,
        rskRecipientRskAddressInfo
    };
};

/**
 * Creates a pegin_btc event with the specified parameters.
 * @param {string} rskRecipientRskAddress the rsk address that receives the funds expected to be in the event.
 * @param {string} btcPeginTxHash the pegin btc tx hash expected to be in the event.
 * @param {number} peginValueInSatoshis the pegin value in satoshis expected to be in the event.
 * @param {string} protocolVersion the pegin protocol version expected to be in the event. Defaults to '0'.
 * @returns {BridgeEvent}
 */
const createExpectedPeginBtcEvent = (rskRecipientRskAddress, btcPeginTxHash, peginValueInSatoshis, protocolVersion = '0') => {
    const expectedEvent = {
        ...PEGIN_EVENTS.PEGIN_BTC,
        arguments: {
            receiver: ensure0x(rskRecipientRskAddress),
            btcTxHash: ensure0x(btcPeginTxHash),
            amount: `${peginValueInSatoshis}`,
            protocolVersion,
        },
    }
    return expectedEvent;
};

/**
 * Gets the active and retiring federation utxos balance in the Bridge and sum them
 * @param {RskTransactionHelper} rskTxHelper to make transactions to the rsk network
 * @returns {Promise<number>} the sum of the utxos in the Bridge
 */
const getBridgeUtxosBalance = async (rskTxHelper) => {
    const activeFederationUtxos = await getActiveFederationUtxos(rskTxHelper);
    const oldFederationUtxos = await getOldFederationUtxos(rskTxHelper);
    const totalUtxos = [...activeFederationUtxos, ...oldFederationUtxos];
    const utxosSum = totalUtxos.reduce((sum, utxo) => sum + utxo.valueInSatoshis, 0);
    return utxosSum;
};

/**
 * Gets the active Federation balance in satoshis, Bridge utxos balance in Satoshis and the Bridge rsk balance in weis BN (BigNumber)
 * @param {RskTransactionHelper} rskTxHelper to make transactions to the rsk network
 * @param {BtcTransactionHelper} btcTxHelper to make transactions to the bitcoin network
 * @returns {Promise<{federationAddressBalanceInSatoshis: number, retiringFederationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}>}
 */
const get2wpBalances = async (rskTxHelper, btcTxHelper) => {

    const bridge = await getBridge(rskTxHelper.getClient());
    const federationAddress = await bridge.methods.getFederationAddress().call();
    const retiringFederationAddress = await bridge.methods.getRetiringFederationAddress().call();
    const federationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, federationAddress);
    const retiringFederationAddressBalanceInSatoshis = await getBtcAddressBalanceInSatoshis(btcTxHelper, retiringFederationAddress);
    const bridgeUtxosBalanceInSatoshis = await getBridgeUtxosBalance(rskTxHelper);
    const bridgeBalanceInWeisBN = await rskTxHelper.getBalance(BRIDGE_ADDRESS);

    return {
      federationAddressBalanceInSatoshis,
      retiringFederationAddressBalanceInSatoshis,
      bridgeUtxosBalanceInSatoshis,
      bridgeBalanceInWeisBN,
    };
    
};

/**
 * Creates a rejected_pegin event with the specified parameters.
 * @param {string} btcPeginTxHash the pegin btc tx hash expected to be in the event.
 * @param {string} rejectionReason the pegin rejection reason.
 * @returns {BridgeEvent}
 */
const createExpectedRejectedPeginEvent = (btcPeginTxHash, rejectionReason) => {
    const expectedEvent = {
        ...PEGIN_EVENTS.REJECTED_PEGIN,
        arguments: {
            btcTxHash: ensure0x(btcPeginTxHash),
            reason: rejectionReason,
        },
    }
    return expectedEvent;
};

const createExpectedUnrefundablePeginEvent = (btcPeginTxHash, rejectionReason) => {
    const expectedEvent = {
        ...PEGIN_EVENTS.UNREFUNDABLE_PEGIN,
        arguments: {
            btcTxHash: ensure0x(btcPeginTxHash),
            reason: rejectionReason,
        },
    }
    return expectedEvent;
};

/**
 * Makes a pegin transaction from the btcSenderAddressInformation in order to 'fund' its corresponding rsk address.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {BtcTransactionHelper} btcTxHelper 
* @param {object} btcSenderAddressInformation the btc object information that contains the btc address and private key to spend funds from
 * @param {number} amountInBtcToFundInBtc defaults to DEFAULT_RSK_ADDRESS_FUNDING_IN_BTC
 * @returns {Promise<string>} the pegin tx hash
 */
const fundRskAccountThroughAPegin = async (rskTxHelper, btcTxHelper, btcSenderAddressInfo, amountInBtcToFundInBtc = DEFAULT_RSK_ADDRESS_FUNDING_IN_BTC) => {
    const btcPeginTxHash = await sendPeginToActiveFederation(rskTxHelper, btcTxHelper, btcSenderAddressInfo, amountInBtcToFundInBtc);
    await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
    return btcPeginTxHash;
};

const createExpectedReleaseRequestRejectedEvent = (rskSenderAddress, amountInSatoshis, rejectionReason) => {
    const expectedEvent = {
        ...PEGOUT_EVENTS.RELEASE_REQUEST_REJECTED,
        arguments: {
            sender: rskSenderAddress,
            amount: amountInSatoshis.toString(),
            reason: rejectionReason,
        },
    }
    return expectedEvent;
};

module.exports = {
    sendTxToBridge,
    assertRefundUtxosSameAsPeginUtxos,
    createPegoutRequest,
    sendPegin,
    ensurePeginIsRegistered,
    isUtxoRegisteredInBridge,
    donateToBridge,
    BTC_TO_RSK_MINIMUM_CONFIRMATIONS,
    BRIDGE_ADDRESS,
    mineForPeginRegistration,
    MIN_PEGOUT_VALUE_IN_RBTC,
    disableWhitelisting,
    createSenderRecipientInfo,
    createExpectedPeginBtcEvent,
    getBridgeUtxosBalance,
    get2wpBalances,
    createExpectedRejectedPeginEvent,
    createExpectedUnrefundablePeginEvent,
    fundRskAccountThroughAPegin,
    createExpectedReleaseRequestRejectedEvent,
    sendPeginToActiveFederation,
    sendPeginToRetiringFederation,
    sendPeginToActiveAndRetiringFederations,
    getActiveFederationUtxos,
    getOldFederationUtxos,
};
