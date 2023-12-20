const bitcoinJs = require('bitcoinjs-lib');
const merkleLib = require('merkle-lib');
const pmtBuilder = require('@rsksmart/pmt-builder');

const publicKeyToCompressed = (publicKey) => {
    return bitcoinJs.ECPair.fromPublicKey(Buffer.from(publicKey, 'hex'), { compressed: true })
        .publicKey
        .toString('hex');
}
  
const fundAddressAndGetData = async (btcTxHelper, addressToFund, amountToFundInBtc, amountForFunderInBtc, btcTypeOfAddress = 'legacy') => {
    const btcSenderAddressInformation = await btcTxHelper.generateBtcAddress(btcTypeOfAddress);
    await btcTxHelper.fundAddress(btcSenderAddressInformation.address, amountForFunderInBtc);

    const recipientsTransactionInformation = [{ 
        recipientAddress: addressToFund, 
        amountInBtc: amountToFundInBtc 
    }];
    const txId = await btcTxHelper.transferBtc(btcSenderAddressInformation, recipientsTransactionInformation);

    // Wait for the pegin to be in the bitcoin mempool before mining
    await waitForBitcoinTxToBeInMempool(btcTxHelper, txId);

    const rawTx = await btcTxHelper.nodeClient.getRawTransaction(txId);

    await btcTxHelper.importAddress(addressToFund);

    const blockHash = await btcTxHelper.mine();
    const blockWithFundingTx = await btcTxHelper.nodeClient.getBlock(blockHash[0], true);
    const blockHeight = blockWithFundingTx.height;
    const fundingBtcTx = await btcTxHelper.getTransaction(txId);

    // if it's a segwit transaction this will add into the return data the info needed to register the coinbase
    if (btcTypeOfAddress === 'p2sh-segwit'){
        const txs = [];
        for (const tx of blockWithFundingTx.tx) {
            txs.push(await btcTxHelper.getTransaction(tx));
        }

        const coinbaseTx = txs[0];
        const blockHash = blockWithFundingTx.hash;
        const witnessReservedValue = coinbaseTx.ins[0].witness[0].toString('hex');
        const coinbaseTxWithoutWitness = bitcoinJs.Transaction.fromBuffer(coinbaseTx.__toBuffer(undefined, undefined, false));
        const coinbaseTxHashWithoutWitness = coinbaseTxWithoutWitness.getId();
    
        // Create PMT for coinbase
        const coinbasePmt = pmtBuilder.buildPMT(blockWithFundingTx.tx, coinbaseTxHashWithoutWitness);
    
        // Calculate witnessRoot
        const hashesWithWitness = txs.map(x => Buffer.from(x.getHash(true)));
        const witnessMerkleTree = merkleLib(hashesWithWitness, bitcoinJs.crypto.hash256);
    
        // Get witness merkleRoot from witnessMerkleTree. This is equals to the last element in witnessMerkleTree array
        const witnessMerkleRoot = witnessMerkleTree[witnessMerkleTree.length-1].reverse();
        const reversedHashesWithWitness = txs.map(x => Buffer.from(x.getHash(true)).reverse().toString('hex'));
        const btcTxPmt = pmtBuilder.buildPMT(reversedHashesWithWitness, fundingBtcTx.getHash(true).reverse().toString('hex'));
    
        return {
            rawTx: rawTx,
            pmt: btcTxPmt.hex,
            height: blockHeight,
            coinbaseParams: {
                coinbaseTxWithoutWitness: coinbaseTxWithoutWitness,
                blockHash: blockHash,
                pmt: coinbasePmt,
                witnessMerkleRoot: witnessMerkleRoot,
                witnessReservedValue: witnessReservedValue
            }
        };
    } else {
        const pmt = pmtBuilder.buildPMT(blockWithFundingTx.tx, txId);
        return {
            rawTx: rawTx,
            pmt: pmt.hex,
            height: blockHeight
        };
    }
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
const waitForBitcoinTxToBeInMempool = async (btcTxHelper, btcTxHash, maxAttempts = 3, checkEveryMilliseconds = 500) => {

    const bitcoinMempoolHasTx = async () => {
      const bitcoinMempool = await getBitcoinTransactionsInMempool(btcTxHelper);
      const isTxInMempool = bitcoinMempool.includes(btcTxHash);
      if(!isTxInMempool) {
        console.debug(`Attempting to check if the btc tx (${btcTxHash}) was already mined since it's not in the mempool yet.`);
        const tx = await btcTransactionHelper.getTransaction(btcTxHash);
        if(tx) {
          console.debug(`The btc tx (${btcTxHash}) was already mined.`);
          return true;
        }
        return false;
      }
      return true;
    };
  
    const checkBitcoinMempoolHasTx = async (btcTxAlreadyFound, currentAttempts) => {
      if(btcTxAlreadyFound) {
        console.debug(`The btc tx ${btcTxHash} was found in the mempool at attempt ${currentAttempts}.`);
      } else {
        console.log(`Attempting to get the btc tx ${btcTxHash} in the mempool. Attempt: ${currentAttempts}.`);
      }
      return btcTxAlreadyFound;
    };
  
    const onError = async (e) => {
      if(e.message.includes('No such mempool or blockchain transaction')) {
        console.debug(`The btc tx ${btcTxHash} is not in the mempool nor mined yet. Let's allow some more time before retrying to get it.`);
        return true;
      }
      console.error(`Un expected error while trying to get the btc tx ${btcTxHash} in the mempool.`, e);
      throw e;
    };
  
    const { result: btcTxAlreadyFoundInMempool } = retryWithCheck(
        bitcoinMempoolHasTx, 
        checkBitcoinMempoolHasTx, 
        maxAttempts, 
        checkEveryMilliseconds, 
        onError
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
const waitForBitcoinMempoolToGetTxs = async (btcTxHelper, maxAttempts = 3, checkEveryMilliseconds = 500) => {
    const initialBitcoinMempoolSize = (await getBitcoinTransactionsInMempool(btcTxHelper)).length;
    console.debug(`[waitForBitcoinMempoolToGetTxs] The initial bitcoin mempool size is ${initialBitcoinMempoolSize}.`);
    console.debug(`Will wait and attempt to check if the bitcoin mempool has received any new transactions ${maxAttempts} times.`);
  
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
  
    console.debug(`[waitForBitcoinMempoolToGetTxs] The final bitcoin mempool size is ${finalBitcoinMempoolSize}, after ${attempts} attempts. Difference with initial mempool size: ${finalBitcoinMempoolSize - initialBitcoinMempoolSize}.`);
  
    return bitcoinMempoolHasTx;
  }

  module.exports = {
    publicKeyToCompressed,
    fundAddressAndGetData,
    getBitcoinTransactionsInMempool,
    waitForBitcoinTxToBeInMempool,
    waitForBitcoinMempoolToGetTxs
  }
