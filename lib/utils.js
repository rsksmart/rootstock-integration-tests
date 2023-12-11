var fs = require('fs-extra');
var utils = require('peglib').utils;
const merkleLib = require('merkle-lib');
const pmtBuilder = require('@rsksmart/pmt-builder');
const bitcoinJs = require('bitcoinjs-lib');

var sequentialPromise = function(n, promiseReturn) {
  if (n <= 0) {
    return;
  }
  return promiseReturn(n).then(() => sequentialPromise(n - 1, promiseReturn));
};

const publicKeyToCompressed = function(publicKey) {
  return bitcoinJs.ECPair.fromPublicKey(Buffer.from(publicKey, 'hex'), { compressed: true })
  .publicKey
  .toString('hex');
}

var mapPromiseAll = function(map) {
  var promises = Object.keys(map).map(key => map[key].then(result => ({ key, result })));
  return Promise.all(promises).then(arr => {
    var resolvedMap = {};
    arr.forEach(({ key, result }) => {
      resolvedMap[key] = result;
    });
    return resolvedMap;
  });
};

var wait = (msec) => new Promise((resolve) => setTimeout(resolve, msec));

var randomElement = (array) => array.length === 0 ? undefined : array[getRandomInt(0, array.length)];

var randomNElements = (array, n) => {
  var remaining = array.map((_, i) => i);
  var pick = [];
  for (var i = 0; i < n; i++) {
    var index = getRandomInt(0, remaining.length);
    pick.push(array[remaining[index]]);
    remaining.splice(index ,1);
  }
  return pick;
};

var getRandomInt = (min, max) => {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
}

let ensure0x = (value) => value.substr(0, 2) == '0x' ? value : `0x${value}`;

const executeWithRetries = async(method, retries, delay) => {
    for (let j = 0; j < retries; j++) {
        try {
            return await method();
        } catch (e) {
        }
        await wait(delay);
    }
    throw new Error("couldn't execute method");
}

const removeDir = (folder) => {
    let path = require('path');
    let isDir = fs.statSync(folder).isDirectory();

    if (!isDir) {
      return;
    }

    let files = fs.readdirSync(folder);

    if (files.length > 0) {
      files.forEach(function(file) {
        let fullPath = path.join(folder, file);
        removeDir(fullPath);
      });

      files = fs.readdirSync(folder);
    }

    if (files.length == 0) {
      fs.rmdirSync(folder);
      return;
    }
}

const fundAddressAndGetData = async (btcTxHelper, addressToFund, amountToFundInBtc, amountForFunderInBtc, btcTypeOfAddress = 'legacy') => {

  const btcSenderAddressInformation = await btcTxHelper.generateBtcAddress(btcTypeOfAddress);
  
  await btcTxHelper.fundAddress(btcSenderAddressInformation.address, amountForFunderInBtc);

  const recipientsTransactionInformation = [
    { recipientAddress: addressToFund, amountInBtc: amountToFundInBtc }
  ];

  const txId = await btcTxHelper.transferBtc(btcSenderAddressInformation, recipientsTransactionInformation);

  // Wait for the pegin to be in the bitcoin mempool before mining
  await waitForBtcTxToBeInMempool(btcTxHelper, txId);

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

const getAdditionalFederationAddresses = () => 
  [].concat(global.Runners.common.additionalFederationAddresses);

const addAdditionalFederationAddress = (address) => {
  if (!global.Runners.common.additionalFederationAddresses.includes(address)) {
    global.Runners.common.additionalFederationAddresses.push(address);
  }
};

const removeAdditionalFederationAddress = (address) => {
  global.Runners.common.additionalFederationAddresses =
    global.Runners.common.additionalFederationAddresses.filter(e => e != address);
};

const removePrefix0x = hash => hash.substr(2);

/**
 * 
 * @param {function} method function to execute
 * @param {function} check callback function to check the result of the method.
 * If this callback returns true, then the method call is considered successful and the result is returned.
 * Otherwise, the method is executed again.
 * @param {number} maxAttempts defaults to 5
 * @param {number} delayInMilliseconds defaults to 2000 milliseconds
 * @param {function} onError callback function for the caller to check the thrown error. If the callback returns true, then the function will stop executing.
 * If this callback is not provided, then the error will be thrown.
 * @returns {Promise<any>} the result of the method call or the last value of `result` after the attempts.
 */
const retryWithCheck = async (method, check, maxAttempts = 5, delayInMilliseconds = 2000, onError) => {
  let currentAttempts = 1;
  let result;
  while(currentAttempts <= maxAttempts) {
    try {
      result = await method();
      if(!check || (await check(result, currentAttempts))) {
        return result;
      }
      await wait(delayInMilliseconds);
      currentAttempts++;
    } catch (e) {
      if(!onError) {
        throw e;
      }
      if(await onError(e)) {
        break;
      }
    }
  }
  return result;
};

/**
 * 
 * @param {BtcTransactionHelper} btcTxHelper 
 * @returns {Array<string>} the mempool tx ids
 */
const getBitcoinMempool = async (btcTxHelper) => {
  const mempool = await btcTxHelper.nodeClient.execute('getrawmempool', []);
  return mempool;
};

/**
 * 
 * @param {BtcTransactionHelper} btcTxHelper 
 * @param {string} btcTxHash 
 */
const waitForBtcTxToBeInMempool = async (btcTxHelper, btcTxHash) => {

  const bitcoinMempoolHasTx = async () => {
    const bitcoinMempool = await getBitcoinMempool(btcTxHelper);
    const txIsInMempool = bitcoinMempool.includes(btcTxHash);
    if(!txIsInMempool) {
      console.debug(`Attempting to check if the btc tx (${btcTxHash}) was already mined since it's not in the mempool yet.`);
      const tx = await btcTransactionHelper.getTransaction(btcTxHash);
      if(tx) {
        console.debug(`The btc tx (${btcTxHash}) was already mined.`);
        return true;
      }
    } else {
      return true;
    }
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

  await retryWithCheck(bitcoinMempoolHasTx, checkBitcoinMempoolHasTx, 5, 1000, onError);
};

/**
 * Waits until the btc mempool has at least one tx.
 * @param {BtcTransactionHelper} btcTxHelper 
 * @returns {boolean}
 */
const waitForBtcMempoolToGetTxs = async (btcTxHelper) => {

  const initialBitcoinMempoolSize = (await getBitcoinMempool(btcTxHelper)).length;

  console.debug(`[waitForBtcMempoolToGetTxs] The initial btc mempool size is ${initialBitcoinMempoolSize}.`);

  const getBitcoinMempoolSize = async () => {
    const bitcoinMempool = await getBitcoinMempool(btcTxHelper);
    const bitcoinMempoolSize = bitcoinMempool.length;
    return bitcoinMempoolSize;
  };

  const checkBtcMempoolIsNotEmpty = async (bitcoinMempoolSize, currentAttempts) => {
    console.debug(`The btc mempool has ${bitcoinMempoolSize} txs at attempt ${currentAttempts}.`);
    return bitcoinMempoolSize > 0;
  };

  const onError = async (e) => {
    console.error(`Un expected error while trying to get the btc mempool.`, e);
    throw e;
  };

  return await retryWithCheck(getBitcoinMempoolSize, checkBtcMempoolIsNotEmpty, 5, 1000, onError);
}

module.exports = {
  sequentialPromise: sequentialPromise,
  mapPromiseAll: mapPromiseAll,
  wait: wait,
  randomElement: randomElement,
  randomNElements: randomNElements,
  getRandomInt: getRandomInt,
  isPromise: utils.isPromise,
  interval: utils.interval,
  publicKeyToCompressed,
  ensure0x: ensure0x,
  removeDir: removeDir,
  executeWithRetries: executeWithRetries,
  fundAddressAndGetData,
  additionalFederationAddresses: {
    get: getAdditionalFederationAddresses,
    add: addAdditionalFederationAddress,
    remove: removeAdditionalFederationAddress
  },
  removePrefix0x,
  retryWithCheck,
  getBitcoinMempool,
  waitForBtcTxToBeInMempool,
  waitForBtcMempoolToGetTxs,
}
