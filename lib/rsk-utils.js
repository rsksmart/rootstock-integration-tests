const expect = require('chai').expect;
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const { getBridge } = require('./precompiled-abi-forks-util');
const hopBridgeTxParser = require('bridge-transaction-parser-hop400');
const fingerrootBridgeTxParser = require('bridge-transaction-parser');
const BridgeTransactionParser = require('bridge-transaction-parser-lovell700');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { wait, retryWithCheck, removePrefix0x } = require('./utils');
const { waitForBitcoinMempoolToGetTxs } = require('./btc-utils');
const { getLogger } = require('../logger');

const BTC_TO_RSK_MINIMUM_ACCEPTABLE_CONFIRMATIONS = 3;
const RSK_TO_BTC_MINIMUM_ACCEPTABLE_CONFIRMATIONS = 3;

const logger = getLogger();

/**
 * 
 * @param {Array<RskTransactionHelper>} rskTransactionHelpers to check which one has the latest block number
 * @returns {Number} latest block number of the rskTransactionHelpers
 */
const getMaxBlockNumber = async (rskTransactionHelpers) => {
  const fedsLatestBlockNumbersPromises = rskTransactionHelpers.map(rskTxHelper => rskTxHelper.getBlockNumber())
  const fedLatestBlockNumbers = await Promise.all(fedsLatestBlockNumbersPromises);
  const latestBlockNumber = Math.max(...fedLatestBlockNumbers);
  return latestBlockNumber;
};

/**
 * 
 * @param {Array<RskTransactionHelper>} rskTransactionHelpers 
 * @returns {Promise<Number[]>} latest block numbers of all rskTransactionHelpers that are now synched and should have the same latest block number
 */
const waitForSync = async (rskTransactionHelpers) => {
  const latestBlockNumber = await getMaxBlockNumber(rskTransactionHelpers);
  const waitForBlockPromises = rskTransactionHelpers.map(rskTxHelper => waitForBlock(rskTxHelper.getClient(), latestBlockNumber));
  const latestBlocksSynched = await Promise.all(waitForBlockPromises);
  return latestBlocksSynched;
};

/**
 * Wait for the rsk blockchain to advance to the specified block number, attempting to find a new block `maxAttempts` times, checking every `waitTime` milliseconds.
 * If the blockchain doesn't advance after `maxAttempts` attempts, it will consider the blockchain as stuck and it will throw an error.
 * It will reset the attempts counter every time the blockchain advances as least 1 block.
 * It will potentially try to find new blocks `maxAttempts` times for every block.
 * If the blockchain is at least advancing, we know that some time in the future the `blockNumber` will be reached, so no need to stop trying to find it.
 * @param {Web3} rskClient web3 client to make calls to the rsk network.
 * @param {Number} blockNumber min block height to wait for.
 * @param {Number} waitTime defaults to 500 milliseconds. Time to wait before checking for the block on every iteration.
 * @param {Number} maxAttempts defaults to 500 attempts by block.
 * @returns {Promise<Number>} the latest block number the same or greater than `blockNumber`.
 */
const waitForBlock = (rskClient, blockNumber, waitTime = 500, maxAttempts = 500) => {
  return new Promise((resolve, reject) => {
    let attempts = 1;
    let latestBlockNumber = -1;
    const checkBlockNumber = () => {
      rskClient.eth.getBlockNumber().then(newLatestBlockNumber => {
        const expectedMinBlockHeightReached = newLatestBlockNumber >= blockNumber;
        if (expectedMinBlockHeightReached) {
          return resolve(newLatestBlockNumber);
        }
        const isAdvancing = newLatestBlockNumber > latestBlockNumber;
        if(isAdvancing) {
          latestBlockNumber = newLatestBlockNumber;
          attempts = 0;
        } else {
          if (attempts++ === maxAttempts) {
            const message = `Blockchain not advancing after attempting to find a new block ${maxAttempts} times checking every ${waitTime} milliseconds. Couldn't reach block number ${blockNumber}. Last block number seen was: ${newLatestBlockNumber}`;
            return reject(new Error(message));
          }
        }
        setTimeout(checkBlockNumber, waitTime);
      }).catch(error => {
        reject('[waitForBlock] ' + error.stack);
      });
    };
    checkBlockNumber();
  });
};

/**
 * Mines the specified amount of blocks in `blocksToMine` using the first `RskTransactionHelper` in the provided `rskTransactionHelpers` array
 * and makes sure the other `rskTransactionHelpers` sync.
 * @param {Array<RskTransactionHelper>} rskTransactionHelpers An array of `RskTransactionHelper` for each federator node to sync
 * @param {Number} blocksToMine Defaults to 1 if not provided. Returns an error if it's 0 or negative
 * @returns {Promise<Array<Number>>} An array of block numbers, one for each federator node, corresponding to the latest block of each of these fed nodes
 */
const mineAndSync = async (rskTransactionHelpers, blocksToMine = 1) => {

    if(blocksToMine <= 0) {
      throw new Error('`blocksToMine` cannot be zero or negative');
    }
  
    if(!Array.isArray(rskTransactionHelpers) || rskTransactionHelpers.length === 0) {
      throw new Error('`rskTransactionHelpers` cannot be empty');
    }
  
    await rskTransactionHelpers[0].mine(blocksToMine);

    return await waitForSync(rskTransactionHelpers);
  
};

/**
 * Sends `amountInWeis` funds from the `cow` account to the `recipientAddress`
 * @param {RskTransactionHelper} rskTxHelper to make transactions to the rsk network
 * @param {String} recipientAddress address to receive the funds
 * @param {Number | string} amountInWeis amount in weis to be sent to the recipient address
 */
const sendFromCow = async (rskTxHelper, recipientAddress, amountInWeis) => {

  const cowAddress = await rskTxHelper.newAccountWithSeed('cow');
  const initialAddressBalanceInWeis = Number(await rskTxHelper.getBalance(recipientAddress));

  const txPromise = rskTxHelper.getClient().eth.sendTransaction({
    from: cowAddress,
    to: recipientAddress,
    value: amountInWeis
  });

  await wait(1000);
  await mineAndSync(getRskTransactionHelpers());
  await txPromise;

  const finalBalance = await rskTxHelper.getBalance(recipientAddress);

  expect(Number(finalBalance)).to.equal(initialAddressBalanceInWeis + Number(amountInWeis));

};

/**
 * Mines the amount of blocks needed to reach the next pegout creation height
 * @param {RskTransactionHelper} rskTransactionHelper 
 */
const increaseBlockToNextPegoutHeight = async (rskTransactionHelpers) => {
  const rskTransactionHelper = rskTransactionHelpers[0];
  const bridge = getBridge(rskTransactionHelper.getClient());
  const nextPegoutCreationBlockNumber = await bridge.methods.getNextPegoutCreationBlockNumber().call();
  const currentBlockNumber = await getMaxBlockNumber(rskTransactionHelpers);
  const blocksNeededToReachHeight = nextPegoutCreationBlockNumber - currentBlockNumber;
  if(blocksNeededToReachHeight > 0) {
    await mineAndSync(rskTransactionHelpers, blocksNeededToReachHeight)
  }
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
  
  // Wait for the rsk `updateBridge` tx to be in the rsk mempool before mining
  await waitForRskMempoolToGetNewTxs(rskTxHelper);

  await mineAndSync(getRskTransactionHelpers());
};

/**
 * 
 * @param {RskTransactionHelper} rskTxHelper 
 * @returns {Promise<string[]>} array of tx hashes in the mempool
 */
const getRskMempoolTransactionHashes = async (rskTxHelper) => {
  const mempoolBlock = await rskTxHelper.getClient().eth.getBlock('pending');
  return mempoolBlock.transactions;
};

/**
 * 
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} txHash 
 * @param {number} maxAttempts Defaults to 3
 * @param {number} checkEveryMilliseconds Defaults to 500 milliseconds
 * @returns {Promise<boolean>} whether the tx is in the mempool or not
 */
const waitForRskTxToBeInTheMempool = async (rskTxHelper, txHash, maxAttempts = 3, checkEveryMilliseconds = 500) => {

  const method = async () => {
    
    const tx = await rskTxHelper.getClient().eth.getTransaction(txHash);

    const isTxInTheMempool = tx && !tx.blockNumber;

    if(isTxInTheMempool) {
      logger.debug(`[${waitForRskTxToBeInTheMempool.name}::${method.anme}] The tx (${txHash}) is in the mempool`);
      return true;
    }
    
    const isTxAlreadyMined = tx && tx.blockNumber;

    if(isTxAlreadyMined) {
      logger.debug(`[${waitForRskTxToBeInTheMempool.name}::${method.anme}] The tx (${txHash}) is already mined in a block`);
      return true;
    }

    logger.debug(`[${waitForRskTxToBeInTheMempool.name}::${method.anme}] The tx (${txHash}) is not in the mempool nor in a block yet. Will keep retrying until it is in the mempool, block, or it reaches the max attempts to find it`);
    
    return false;

  };

  const check = async (txIsInTheMempool, currentAttempts) => {
    logger.debug(`[${waitForRskTxToBeInTheMempool.name}::${check.name}] Attempting to find the tx ${txHash} in the mempool. Attempt ${currentAttempts} out of ${maxAttempts}`);
    return txIsInTheMempool;
  };

  const { result: isTxInTheMempool, attempts } = await retryWithCheck(method, check, maxAttempts, checkEveryMilliseconds);

  logger.debug(`[${waitForRskTxToBeInTheMempool.name}] Tx ${txHash} was found in the rsk mempool or mined: ${isTxInTheMempool}, after ${attempts} attempts.`);

  return isTxInTheMempool;

};

/**
 * 
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {number} maxAttempts Defaults to 3
 * @param {number} checkEveryMilliseconds Defaults to 500 milliseconds
 * @returns {Promise<boolean>} whether the mempool has new txs or not
 */
const waitForRskMempoolToGetNewTxs = async (rskTxHelper, maxAttempts = 3, checkEveryMilliseconds = 500) => {
      
    const initialRskMempoolTxHashes = await getRskMempoolTransactionHashes(rskTxHelper);

    logger.debug(`[${waitForRskMempoolToGetNewTxs.name}] initial rsk mempool size: ${initialRskMempoolTxHashes.length}`);
    logger.debug(`[${waitForRskMempoolToGetNewTxs.name}] Will wait and attempt to check if the rsk mempool has received any new transactions ${maxAttempts} times.`);

    const areThereNewTxsInTheMempool = async () => {
      const mempoolTxHashes = await getRskMempoolTransactionHashes(rskTxHelper);
      if(mempoolTxHashes.length > initialRskMempoolTxHashes.length) {
        logger.debug(`[${waitForRskMempoolToGetNewTxs.name}] The mempool got ${mempoolTxHashes.length - initialRskMempoolTxHashes.length} new transactions`);
        return true;
      }
      return false;
    };
  
    const check = async (mempoolHasTxs) => {
      return mempoolHasTxs;
    };
  
    const { result: newTxsWhereFoundInTheRskMempool, attempts } = await retryWithCheck(areThereNewTxsInTheMempool, check, maxAttempts, checkEveryMilliseconds);
  
    const finalRskMempoolTxHashes = await getRskMempoolTransactionHashes(rskTxHelper);

    logger.debug(`[${waitForRskMempoolToGetNewTxs.name}] final rsk mempool size: ${finalRskMempoolTxHashes.length}, after ${attempts} attempts. Difference with initial mempool size: ${finalRskMempoolTxHashes.length - initialRskMempoolTxHashes.length}`);

    return newTxsWhereFoundInTheRskMempool;

  };

/**
 * 
 * @param {Array<RskTransactionHelper>} rskTransactionHelpers RskTransactionHelper instances each belonging to one federator node to make calls to the rsk network
 * @param {BtcTransactionHelper} btcClient BtcTxHelper instance to make calls to the btc network
 * @param {{pegoutCreatedCallback, pegoutConfirmedCallback, releaseBtcCallback}} callbacks for each step where an event is supposed to be emitted, to be handled by the caller
 */
const triggerRelease = async (rskTransactionHelpers, btcClient, callbacks = {}) => {

  const rskTxHelper = rskTransactionHelpers[rskTransactionHelpers.length - 1];

  await increaseBlockToNextPegoutHeight(rskTransactionHelpers);

  // Adds the pegout to the pegoutsWaitingForConfirmations structure with this 1 confirmation
  // release_request_received and batch_pegout_created triggered here (if appropriate fork, RSKIP185 and RSKIP271, is/are active)
  await waitAndUpdateBridge(rskTxHelper);

  if(callbacks.pegoutCreatedCallback) {
    await callbacks.pegoutCreatedCallback(rskTxHelper);
  }

  // Adds `BTC_TO_RSK_MINIMUM_ACCEPTABLE_CONFIRMATIONS` - 1 (a - 1 here because we already mined 1 block above) more confirmations to the pegout. Now it has `BTC_TO_RSK_MINIMUM_ACCEPTABLE_CONFIRMATIONS` and is ready to be moved to the pegoutsWaitingForSignatures
  await mineAndSync(rskTransactionHelpers, BTC_TO_RSK_MINIMUM_ACCEPTABLE_CONFIRMATIONS - 1);
  
  // Moves the pegout from pegoutsWaitingForConfirmations to pegoutsWaitingForSignatures
  // pegout_confirmed event triggered here (if appropriate fork, RSKIP326, is active)
  await waitAndUpdateBridge(rskTxHelper);

  if(callbacks.pegoutConfirmedCallback) {
    await callbacks.pegoutConfirmedCallback(rskTxHelper);
  }

  const MAX_ATTEMPTS = 20;
  const CHECK_EVERY_MILLISECONDS = 2000;
  
  // At this point, the pegout is in the `pegoutsWaitingForSignatures` structure in the bridge.
  // We will allow enough time for the federator nodes to call `addSignature`
  // and when the pegout is no longer in the `pegoutsWaitingForSignatures`, it means it has been already broadcasted to the btc network.
  // Usually this happens after the first or second attempts. This part is the only uncertainty because the fed nodes have to call `addSignature` on their own
  // and we can not make them call `addSignature` on demand.
  logger.debug(`[${triggerRelease.name}] Waiting and retrying until pegout is broadcasted with a maximum attempt of: ${MAX_ATTEMPTS} and checking every: ${CHECK_EVERY_MILLISECONDS} milliseconds.`);

  const method = async () => {
    const currentBridgeState = await getBridgeState(rskTxHelper.getClient());
    if(currentBridgeState.pegoutsWaitingForSignatures.length === 0) {
      return true; // Returning true to stop the retryWithCheck loop early
    }
    await wait(1000);
    await mineAndSync(rskTransactionHelpers);
    return false; // Returning false to make the retryWithCheck loop continue until this check returns true or it reaches the max attempts
  };
  
  const { result: wasPegoutBroadcasted, attempts } = await retryWithCheck(method, pegoutIsBroadcasted => pegoutIsBroadcasted, MAX_ATTEMPTS, CHECK_EVERY_MILLISECONDS);

  logger.debug(`[${triggerRelease.name}] Pegout broadcasted: ${wasPegoutBroadcasted}, after ${attempts} attempts.`);

  // Last add_signature and release_btc events emitted here at the block that just broadcasted the pegout to the btc network.
  if(callbacks.releaseBtcCallback) {
    await callbacks.releaseBtcCallback(rskTxHelper);
  }

  // Waiting to make sure that the pegout tx is in the bitcoin mempool before mining the required blocks for confirmation.
  await waitForBitcoinMempoolToGetTxs(btcClient);

  // From the btc network side, mine `RSK_TO_BTC_MINIMUM_ACCEPTABLE_CONFIRMATIONS + 1` blocks, 1 for the pegout funds to be mined and reflected in the recipient address,
  // and `RSK_TO_BTC_MINIMUM_ACCEPTABLE_CONFIRMATIONS` more to have enough confirmation for the change balance to be reflected back in the bridge (like a pegin)
  await btcClient.mine(RSK_TO_BTC_MINIMUM_ACCEPTABLE_CONFIRMATIONS + 1);

  // Make pegnatories register the change utxo back in the bridge
 // After this point the bridge should already have the change uxto registered
  await waitAndUpdateBridge(rskTxHelper);

};

/**
 * Calls the `method` as a `send` transaction and wait for the transaction receipt to be available.
 * @param {RskTransactionHelper} rskTxHelper to make transactions to the rsk network
 * @param {web3.eth.Contract.ContractSendMethod} method contract method to be invoked
 * @param {string} from rsk address to send the transaction from
 * @returns {web3.eth.TransactionReceipt} txReceipt
*/
const sendTransaction = async (rskTxHelper, method, from) => {

  const estimatedGas = await method.estimateGas({ from });

  const txReceiptPromise = method.send({ from, value: 0, gasPrice: 0, gas: estimatedGas });

  await waitForRskMempoolToGetNewTxs(rskTxHelper);
  await mineAndSync(getRskTransactionHelpers());

  return await txReceiptPromise;

};


/**
 * Executes a method 'call' and calls the callback with the result of the call, then calls 'send' and waits for the transaction receipt to be available and returns it
 * @param {RskTransactionHelper} rskTxHelper to make transactions to the rsk network
 * @param {web3.eth.Contract.ContractSendMethod} method contract method to be invoked
 * @param {string} from rsk address to send the transaction from
 * @param {function} checkCallback callback to check the result of the method 'call' before calling 'send'
 * @returns {web3.eth.TransactionReceipt} txReceipt
 */
const sendTxWithCheck = async (rskTxHelper, method, from, checkCallback) => {

  if(!checkCallback) {
    throw new Error('`checkCallback` is required');
  }

  const callResult = await method.call({ from });
  await checkCallback(callResult);

  return await sendTransaction(rskTxHelper, method, from);

};

/**
 * 
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} eventName
 * @param {string | number} fromBlockHashOrBlockNumber optional. If not provided, it will start searching from the latest block number provided by the `rskTxHelper.getBlockNumber()`
 * @param {string | number} toBlockHashOrBlockNumber optional. If provided, needs to be greater than `fromBlockHashOrBlockNumber`
 * @param {(BridgeEvent) => boolean} check, check callback, optional. If provided, calls it with the event found by the `eventName`
 *  and expect to receive a boolean value. If `check` returns false, it will continue searching for the event, otherwise it will return the event found.
 * @returns {BridgeEvent} event
 */
const findEventInBlock = async (rskTxHelper, eventName, fromBlockHashOrBlockNumber, toBlockHashOrBlockNumber, check) => {
  if(!fromBlockHashOrBlockNumber) {
    fromBlockHashOrBlockNumber = await rskTxHelper.getBlockNumber();
  }
  if(!toBlockHashOrBlockNumber) {
    toBlockHashOrBlockNumber = fromBlockHashOrBlockNumber;
  }
  if(fromBlockHashOrBlockNumber > toBlockHashOrBlockNumber) {
    throw new Error(`fromBlockHashOrBlockNumber: ${fromBlockHashOrBlockNumber} is greater than toBlockHashOrBlockNumber: ${toBlockHashOrBlockNumber}`);
  }

  while(fromBlockHashOrBlockNumber <= toBlockHashOrBlockNumber) {
    const bridgeTransactions = await findBridgeTransactionsInThisBlock(rskTxHelper.getClient(), fromBlockHashOrBlockNumber);
    for(let i = 0; i < bridgeTransactions.length; i++) {
      const tx = bridgeTransactions[i];
      const event = tx.events.find(event => {
        return event.name === eventName;
      });
      if(event) {
        if(check) {
          const found = await check(event, tx);
          if(!found) {
            continue;
          }
        }
        return event;
      }
    }
    fromBlockHashOrBlockNumber++;
  }
  return null;
};

const findBridgeTransactionsInThisBlock = async (web3Client, blockHashOrBlockNumber) => {

  // TODO: uncomment this when lovell700 is active.
  // const bridgeTransactionParser = new BridgeTransactionParser(web3Client);
  // return bridgeTransactionParser.getBridgeTransactionsInThisBlock(blockHashOrBlockNumber);

  return fingerrootBridgeTxParser.getBridgeTransactionsInThisBlock(web3Client, blockHashOrBlockNumber);
}

/**
 * Imports the private key and unlocks the rskAddress, asserting that the rskAddress returned by the private key import is the same as the rskAddress provided.
 * @param {RskTransactionHelper} rskTxHelper 
 * @param {string} privateKey to be imported.
 * @param {string} rskAddress to be unlocked.
 * @returns {boolean} true if the rskAddress was unlocked, false otherwise
 */
const getUnlockedAddress = async (rskTxHelper, privateKey, rskAddress) => {
  const importedAddress = await rskTxHelper.importAccount(privateKey);
  expect(importedAddress.slice(2)).to.equal(rskAddress);
  return rskTxHelper.unlockAccount(importedAddress);
};

/**
 * Calls the bridge contract to get the federation public keys
 * @param {Bridge} bridge 
 * @returns {Promise<string[]>}
 */
const getFedsPubKeys = async (bridge) => {
  const fedSize = await bridge.methods.getFederationSize().call();
  const FEDS_PUBKEYS_LIST = [];
  for (let i = 0; i < fedSize; i++) {
    let fedPubKey = await bridge.methods.getFederatorPublicKeyOfType(i, 'btc').call();
    FEDS_PUBKEYS_LIST.push(removePrefix0x(fedPubKey));
  }
  return FEDS_PUBKEYS_LIST;
}

module.exports = {
  mineAndSync,
  waitForBlock,
  sendFromCow,
  getMaxBlockNumber,
  waitForSync,
  triggerRelease,
  increaseBlockToNextPegoutHeight,
  sendTxWithCheck,
  findEventInBlock,
  getUnlockedAddress,
  getFedsPubKeys,
  getRskMempoolTransactionHashes,
  waitForRskTxToBeInTheMempool,
  waitForRskMempoolToGetNewTxs,
  waitAndUpdateBridge,
  sendTransaction,
};
