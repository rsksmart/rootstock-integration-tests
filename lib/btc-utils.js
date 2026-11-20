const bitcoinJs = require('bitcoinjs-lib');
const ECPairFactory = require('ecpair').default;
const ecc = require('tiny-secp256k1');
const merkleLib = require('merkle-lib');
const pmtBuilder = require('@rsksmart/pmt-builder');
const { retryWithCheck } = require('./utils');
const { getLogger } = require('../logger');
const { btcToSatoshis } = require('@rsksmart/btc-eth-unit-converter');

/** @typedef {import('@rsksmart/btc-transaction-helper').BtcTransactionHelper} BtcTransactionHelper */

const logger = getLogger();

/**
 * Gets the hash of the btc transaction whose output the input spends, in the same byte order as its tx id.
 * bitcoinjs keeps the input hash in internal byte order, the reverse of the tx id.
 * @param {object} input a bitcoinjs transaction input
 * @returns {string} the spent tx hash, as a tx id
 */
const getInputSpentTxHash = (input) => Buffer.from(input.hash).reverse().toString('hex');
const ECPair = ECPairFactory(ecc);

const publicKeyToCompressed = (publicKey) => {
    const compressedPublicKey = ECPair.fromPublicKey(Buffer.from(publicKey, 'hex'), {
        compressed: true,
    }).publicKey;
    return Buffer.from(compressedPublicKey).toString('hex');
};

const fundAddressAndGetData = async (
    btcTxHelper,
    addressToFund,
    amountToFundInBtc,
    amountForFunderInBtc,
    btcTypeOfAddress = 'legacy'
) => {
    const btcSenderAddressInformation = await btcTxHelper.generateBtcAddress(btcTypeOfAddress);
    await btcTxHelper.fundAddress(btcSenderAddressInformation.address, amountForFunderInBtc);

    const recipientsTransactionInformation = [
        {
            recipientAddress: addressToFund,
            amountInBtc: amountToFundInBtc,
        },
    ];
    const txId = await btcTxHelper.transferBtc(
        btcSenderAddressInformation,
        recipientsTransactionInformation
    );

    // Wait for the pegin to be in the bitcoin mempool before mining
    await waitForBitcoinTxToBeInMempool(btcTxHelper, txId);

    const rawTx = await btcTxHelper.nodeClient.getRawTransaction(txId);

    const blockHash = await btcTxHelper.mine();
    const blockWithFundingTx = await btcTxHelper.nodeClient.getBlock(blockHash[0], true);
    const blockHeight = blockWithFundingTx.height;
    const fundingBtcTx = await btcTxHelper.getTransaction(txId);

    // if it's a segwit transaction this will add into the return data the info needed to register the coinbase
    if (btcTypeOfAddress === 'p2sh-segwit') {
        const txs = [];
        for (const tx of blockWithFundingTx.tx) {
            txs.push(await btcTxHelper.getTransaction(tx));
        }

        const coinbaseTx = txs[0];
        const blockHash = blockWithFundingTx.hash;
        const witnessReservedValue = Buffer.from(coinbaseTx.ins[0].witness[0]).toString('hex');
        const coinbaseTxWithoutWitness = bitcoinJs.Transaction.fromBuffer(
            coinbaseTx.__toBuffer(undefined, undefined, false)
        );
        const coinbaseTxHashWithoutWitness = coinbaseTxWithoutWitness.getId();

        // Create PMT for coinbase
        const coinbasePmt = pmtBuilder.buildPMT(
            blockWithFundingTx.tx,
            coinbaseTxHashWithoutWitness
        );

        // Calculate witnessRoot
        // bitcoinJs.crypto.hash256 returns a Uint8Array (not a Buffer) since bitcoinjs-lib v7,
        // so it's wrapped here to keep merkle tree nodes as Buffers for the callers relying on
        // Buffer-specific behavior (e.g. toString('hex')) further down the pipeline.
        const hash256 = (data) => Buffer.from(bitcoinJs.crypto.hash256(data));
        const hashesWithWitness = txs.map((x) => Buffer.from(x.getHash(true)));
        const witnessMerkleTree = merkleLib(hashesWithWitness, hash256);

        // Get witness merkleRoot from witnessMerkleTree. This is equals to the last element in witnessMerkleTree array
        const witnessMerkleRoot = witnessMerkleTree[witnessMerkleTree.length - 1].reverse();
        const reversedHashesWithWitness = txs.map((x) =>
            Buffer.from(x.getHash(true)).reverse().toString('hex')
        );
        const btcTxPmt = pmtBuilder.buildPMT(
            reversedHashesWithWitness,
            Buffer.from(fundingBtcTx.getHash(true)).reverse().toString('hex')
        );

        return {
            rawTx: rawTx,
            pmt: btcTxPmt.hex,
            height: blockHeight,
            coinbaseParams: {
                coinbaseTxWithoutWitness: coinbaseTxWithoutWitness,
                blockHash: blockHash,
                pmt: coinbasePmt,
                witnessMerkleRoot: witnessMerkleRoot,
                witnessReservedValue: witnessReservedValue,
            },
        };
    } else {
        const pmt = pmtBuilder.buildPMT(blockWithFundingTx.tx, txId);
        return {
            rawTx: rawTx,
            pmt: pmt.hex,
            height: blockHeight,
        };
    }
};

/**
 * Gets the height of the bitcoin block that includes the transaction
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {string} btcTxHash a mined transaction hash
 * @returns {Promise<number>} the height of the block that includes the transaction
 */
const getBtcTxBlockHeight = async (btcTxHelper, btcTxHash) => {
    const btcTransaction = await btcTxHelper.nodeClient.execute('getrawtransaction', [
        btcTxHash,
        true,
    ]);
    if (!btcTransaction.blockhash) {
        throw new Error(`The btc tx ${btcTxHash} is not mined yet.`);
    }
    const blockHeader = await btcTxHelper.getBlockHeader(btcTransaction.blockhash);
    return blockHeader.height;
};

/**
 *
 * @param {BtcTransactionHelper} btcTxHelper
 * @returns {Promise<Array<string>>} the mempool tx ids
 */
const getBitcoinTransactionsInMempool = async (btcTxHelper) => {
    return await btcTxHelper.nodeClient.execute('getrawmempool', []);
};

/**
 *
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {string} btcTxHash
 * @param {number} maxAttempts defaults to 3
 * @param {number} checkEveryMilliseconds defaults to 500 milliseconds
 * @returns {Promise<boolean>} whether the tx got to the mempool or not after the attempts
 */
const waitForBitcoinTxToBeInMempool = async (
    btcTxHelper,
    btcTxHash,
    maxAttempts = 3,
    checkEveryMilliseconds = 500
) => {
    const isTxKnownToNode = async () => {
        try {
            await btcTxHelper.getTransaction(btcTxHash);
            logger.debug(
                `[${waitForBitcoinTxToBeInMempool.name}::${isTxKnownToNode.name}] The btc tx (${btcTxHash}) is known to the node, either mined or in the mempool.`
            );
            return true;
        } catch (e) {
            if (e.message.includes('No such mempool or blockchain transaction')) {
                logger.debug(
                    `[${waitForBitcoinTxToBeInMempool.name}::${isTxKnownToNode.name}] The btc tx ${btcTxHash} is not in the mempool nor mined yet. Let's allow some more time before retrying to get it.`
                );
                return false;
            }

            logger.debug(
                `[${waitForBitcoinTxToBeInMempool.name}::${isTxKnownToNode.name}] Unexpected error while trying to get the btc tx ${btcTxHash}.`,
                e
            );
            throw e;
        }
    };

    const bitcoinMempoolHasTx = async () => {
        const bitcoinMempool = await getBitcoinTransactionsInMempool(btcTxHelper);
        const isTxInMempool = bitcoinMempool.includes(btcTxHash);
        if (!isTxInMempool) {
            logger.debug(
                `[${waitForBitcoinTxToBeInMempool.name}::${bitcoinMempoolHasTx.name}] Attempting to check if the node knows the btc tx (${btcTxHash}) since it's not in the mempool yet.`
            );
            return isTxKnownToNode();
        }
        return true;
    };

    const checkBitcoinMempoolHasTx = async (btcTxAlreadyFound, currentAttempts) => {
        if (btcTxAlreadyFound) {
            logger.debug(
                `[${waitForBitcoinTxToBeInMempool.name}::${checkBitcoinMempoolHasTx.name}] The btc tx ${btcTxHash} was found in the mempool at attempt ${currentAttempts}.`
            );
        } else {
            logger.debug(
                `[${waitForBitcoinTxToBeInMempool.name}::${checkBitcoinMempoolHasTx.name}] Attempting to get the btc tx ${btcTxHash} in the mempool. Attempt: ${currentAttempts}.`
            );
        }
        return btcTxAlreadyFound;
    };

    const { result: btcTxAlreadyFoundInMempool } = await retryWithCheck(
        bitcoinMempoolHasTx,
        checkBitcoinMempoolHasTx,
        maxAttempts,
        checkEveryMilliseconds
    );

    return btcTxAlreadyFoundInMempool;
};

/**
 * Waits until the bitcoin mempool has at least one tx.
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {number} maxAttempts defaults to 3
 * @param {number} checkEveryMilliseconds defaults to 500 milliseconds
 * @returns {Promise<boolean>}
 */
const waitForBitcoinMempoolToGetTxs = async (
    btcTxHelper,
    maxAttempts = 3,
    checkEveryMilliseconds = 500
) => {
    const initialMempoolTxs = await getBitcoinTransactionsInMempool(btcTxHelper);
    const initialBitcoinMempoolSize = initialMempoolTxs.length;
    logger.debug(
        `[${waitForBitcoinMempoolToGetTxs.name}] The initial bitcoin mempool size is ${initialBitcoinMempoolSize}.`
    );
    logger.debug(
        `[${waitForBitcoinMempoolToGetTxs.name}] Will wait and attempt to check if the bitcoin mempool has received any new transactions ${maxAttempts} times.`
    );

    const getCountOfTransactionsInMempool = async () => {
        const bitcoinMempool = await getBitcoinTransactionsInMempool(btcTxHelper);
        const bitcoinMempoolSize = bitcoinMempool.length;
        return bitcoinMempoolSize;
    };

    const checkBtcMempoolIsNotEmpty = async (bitcoinMempoolSize) => {
        return bitcoinMempoolSize > 0;
    };

    const { result: bitcoinMempoolHasTx, attempts } = await retryWithCheck(
        getCountOfTransactionsInMempool,
        checkBtcMempoolIsNotEmpty,
        maxAttempts,
        checkEveryMilliseconds
    );

    const txsInMempool = await getBitcoinTransactionsInMempool(btcTxHelper);
    const finalBitcoinMempoolSize = txsInMempool.length;

    logger.debug(
        `[${waitForBitcoinMempoolToGetTxs.name}] The final bitcoin mempool size is ${finalBitcoinMempoolSize}, after ${attempts} attempts. Difference with initial mempool size: ${finalBitcoinMempoolSize - initialBitcoinMempoolSize}.`
    );

    return bitcoinMempoolHasTx;
};

const getBtcAddressBalanceInSatoshis = async (btcTxHelper, btcAddress) => {
    if (btcAddress) {
        return Number(btcToSatoshis(await btcTxHelper.getAddressBalance(btcAddress)));
    }
    return 0;
};

/**
 * converts a base58 bitcoin address to its string hash160 representation
 * @param {string} base58Address the bitcoin address in base58 format
 * @returns {string} the hash160 representation of the base58 bitcoin address
 */
const base58AddressToHash160 = (base58Address) => {
    return Buffer.from(bitcoinJs.address.fromBase58Check(base58Address).hash).toString('hex');
};

/**
 * Derives the P2SH-P2WSH address for a given redeem script.
 * @param {Buffer} redeemScript the redeem script
 * @param {object} network a bitcoinjs-lib network object
 * @returns {string} the P2SH-P2WSH address
 */
const getP2shP2wshAddressFromRedeemScript = (redeemScript, network) => {
    return bitcoinJs.payments.p2sh({
        redeem: bitcoinJs.payments.p2wsh({
            redeem: { output: redeemScript },
            network,
        }),
        network,
    }).address;
};

module.exports = {
    getInputSpentTxHash,
    publicKeyToCompressed,
    fundAddressAndGetData,
    getBitcoinTransactionsInMempool,
    getBtcTxBlockHeight,
    waitForBitcoinTxToBeInMempool,
    waitForBitcoinMempoolToGetTxs,
    getBtcAddressBalanceInSatoshis,
    base58AddressToHash160,
    getP2shP2wshAddressFromRedeemScript,
};
