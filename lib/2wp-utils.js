const expect = require('chai').expect;
const { sendFromCow, mineAndSync, sendTxWithCheck, getUnlockedAddress } = require('./rsk-utils');
const { wait, retryWithCheck } = require('./utils');
const { getBridge, getLatestActiveForkName } = require('./precompiled-abi-forks-util');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');

const peginVerifier = require('pegin-address-verificator');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR} = require('../lib/assertions/whitelisting')

const ADDRESS_TYPES_CODES = {
    p2pkh: '01',
    p2sh: '02'
};

const BTC_TO_RSK_MINIMUM_CONFIRMATIONS = 3;
const TO_BRIDGE_GAS_PRICE = 2;
const BRIDGE_ADDRESS = '0x0000000000000000000000000000000001000006';
const MIN_PEGOUT_VALUE_IN_RBTC = 0.0025;

/**
 * 
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {BtcTransactionHelper} btcTxHelper 
 * @param {string} peginTxHash 
 * @param {string} refundAddress 
 */
const assertRefundUtxosSameAsPeginUtxos = async(rskTxHelper, btcTxHelper, peginTxHash, refundAddress) => {
    const bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
    const federationAddress = await bridge.methods.getFederationAddress().call();
    const peginTx = await btcTxHelper.getTransaction(peginTxHash);
    const outputsForFederation = peginTx.outs.filter(output => btcTxHelper.getOutputAddress(output.script) === federationAddress);
    const refundAddressUtxos = await btcTxHelper.getUtxos(refundAddress);
    expect(refundAddressUtxos.length).to.equal(outputsForFederation.length);

    const refundTxHash = refundAddressUtxos[0].txid;
    const refundTx = await btcTxHelper.getTransaction(refundTxHash);
    expect(refundTx.ins.length).to.equal(outputsForFederation.length);
    
    refundTx.ins.forEach((input) => {
        const inputHash = input.hash.reverse().toString('hex');
        expect(inputHash).to.equal(peginTxHash);
    });
};

/**
 * Sends a tx to the bridge
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {number} amountInRbtc 
 * @param {string} rskFromAddress 
 * @param {boolean} mine If true, mines 1 block after sending the transaction. If false, it will not mine the tx and will return undefined. Defaults to true.
 * @returns {web3.eth.TransactionReceipt | undefined}
 */
const sendTxToBridge = async (rskTxHelper, amountInRbtc, rskFromAddress, mine = true) => {
    const txPromise = rskTxHelper.sendTransaction({
      from: rskFromAddress,
      to: BRIDGE_ADDRESS,
      value: Number(btcEthUnitConverter.btcToWeis(amountInRbtc)),
      gasPrice: TO_BRIDGE_GAS_PRICE,
    });
    if(!mine) {
        return;
    }
    await wait(1000);
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
        await sendTxToBridge(rskTxHelper, amountInRBTC, rskAddress, false);
    }
    await mineAndSync(getRskTransactionHelpers());
};

/**
 * Checks if the an utxo with the specified pegin btc tx hash is registered in the bridge
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} peginTxHash to be found in the bridge's utxo list
 * @returns {boolean} returns a boolean value indicating if the pegin was found in the bridge or not
 */
const isUtxoRegisteredInBridge = async (rskTxHelper, peginTxHash, expectedUxtosCount = 1) => {
    const bridgeState = await getBridgeState(rskTxHelper.getClient());
    return bridgeState.activeFederationUtxos
        .filter(utxo =>  utxo.btcTxHash === peginTxHash).length === expectedUxtosCount;
};

const mineForPeginRegistration = async (rskTxHelper, btcTxHelper) => {
    // Enough confirmations to register the coinbase but not the pegin.
    await btcTxHelper.mine(BTC_TO_RSK_MINIMUM_CONFIRMATIONS - 1);
    await waitAndUpdateBridge(rskTxHelper, 500);
    // One more confirmation to register the pegin.
    await btcTxHelper.mine(1);
    await waitAndUpdateBridge(rskTxHelper, 500);
};

/**
 * Simply sends funds to the federation and mines the required btc blocks for the pegin to go through,
 * updates the bridge and mines 1 rsk block for the changes to take effect.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {object} btcSenderAddressInformation the btc object information that contains the btc address and private key to spend funds from
 * @param {Array<number> | number} outputAmountsInBtc the pegin amounts to send to the bridge in btc. If only one amount is sent, it will be converted to an array.
 * @param {Array<string>} data for pegin v1 script
 */
const sendPegin = async (rskTxHelper, btcTxHelper, btcSenderAddressInformation, outputAmountsInBtc, data) => {

    if (!Array.isArray(outputAmountsInBtc)) {
        outputAmountsInBtc = Array.of(outputAmountsInBtc);
    }

    const bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
    const federationAddress = await bridge.methods.getFederationAddress().call();

    const recipientsTransferInformation = outputAmountsInBtc.map(amount => ({ recipientAddress: federationAddress, amountInBtc: amount }));

    const peginBtcTxHash = await btcTxHelper.transferBtc(btcSenderAddressInformation, recipientsTransferInformation, data);
    
    await mineForPeginRegistration(rskTxHelper, btcTxHelper);

    return peginBtcTxHash;

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
        console.debug(`Attempting to find the pegin ${peginBtcTxHash} in the bridge. Attempt ${currentAttempts} out of ${MAX_ATTEMPTS}`);
        if(!utxoIsRegistered) {
            await waitAndUpdateBridge(rskTxHelper, 1000);
        }
        return utxoIsRegistered;
    };

    const utxoIsRegisteredInTheBridge = await retryWithCheck(method, check, MAX_ATTEMPTS, CHECK_EVERY_MILLISECONDS);
    
    if(utxoIsRegisteredInTheBridge) {
        console.debug(`Found pegin ${peginBtcTxHash} registered in the bridge.`);
        // The pegin is already registered in the bridge, but the balance may still not be reflected on the user's rsk address
        // So we need to update the bridge and mine one more block so the balance is reflected on the user's rsk address
        await waitAndUpdateBridge(rskTxHelper);
        return;
     }

    throw new Error(`Could not find the pegin registered in the bridge after ${MAX_ATTEMPTS} attempts`);
  
};

/**
 * Waits for the specified time, updates the bridge and mines 1 rsk block
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {number} timeInMilliseconds defaults to 1000
 * @returns {Promise<void>}
 */
const waitAndUpdateBridge = async (rskTxHelper, timeInMilliseconds = 1000) => {
    await wait(timeInMilliseconds);
    await rskTxHelper.updateBridge();
    await mineAndSync(getRskTransactionHelpers());
};

/**
 * Creates a pegin v1 data for a user to indicate to which rsk address to receive their pegin funds.
 * @param {string} rskDestinationAddress 
 * @param {string} btcRefundAddress 
 * @returns {string} pegin v1 tx data
 */
const createPeginV1TxData = (rskDestinationAddress, btcRefundAddress) => {
    let data = '52534b54'; // 'RSKT' prefix hexa encoded
    data += '01'; // Protocol version
    
    if (rskDestinationAddress.startsWith('0x')) {
        rskDestinationAddress = rskDestinationAddress.substring(2);
    }
    data += rskDestinationAddress;
  
    if (btcRefundAddress) {
        let refundAddressInfo = peginVerifier.getAddressInformation(btcRefundAddress);
        if (refundAddressInfo) {
            data += ADDRESS_TYPES_CODES[refundAddressInfo.type];
            switch (refundAddressInfo.type) {
                case 'p2pkh':
                    data += refundAddressInfo.scriptPubKey;
                    break;
                case 'p2sh':
                    data += refundAddressInfo.scriptHash;
                    break;
                default:
                    throw new Error(`Unsupported btc refund address type: ${refundAddressInfo.type}`);
            }
        } else {
            throw new Error(`Could not get address information for ${btcRefundAddress}`);
        }
    }
    
    return Buffer.from(data, 'hex');
};

/**
 * Sends a pegin donation to the bridge
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {BtcTransactionHelper} btcTxHelper 
 * @param {number} amountInBtc 
 * @returns {string} the pegin tx hash
 */
const donateToBridge = async (rskTxHelper, btcTxHelper, donatingBtcAddressInformation, amountInBtc) => {
    const data = [];
    data.push(createPeginV1TxData(BRIDGE_ADDRESS));
    const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, donatingBtcAddressInformation, amountInBtc, data);
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
    const bridge = getBridge(rskTxHelper.getClient());
    const unlocked = await getUnlockedAddress(rskTxHelper, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);
    expect(unlocked).to.be.true;
    const disableLockWhitelistMethod = bridge.methods.setLockWhitelistDisableBlockDelay(blockDelay);
    const disableResultCallback = (disableResult) => expect(Number(disableResult)).to.equal(1);
    await sendTxWithCheck(rskTxHelper, disableLockWhitelistMethod, WHITELIST_CHANGE_ADDR, disableResultCallback);
    if(blockDelay > 0) {
      await btcTxHelper.mine(blockDelay);
    }
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
    createPeginV1TxData,
    mineForPeginRegistration,
    MIN_PEGOUT_VALUE_IN_RBTC,
    disableWhitelisting
};
