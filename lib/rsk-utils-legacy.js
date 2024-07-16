const expect = require('chai').expect;
const btcClientProvider = require('./btc-client-provider');
const { sequentialPromise, wait, interval } = require('./utils');
const { getBridgeAbi, getLatestActiveForkName } = require('./precompiled-abi-forks-util');
const waitForBlockAttemptTimeMillis = process.env.WAIT_FOR_BLOCK_ATTEMPT_TIME_MILLIS || 200;
const waitForBlockMaxAttempts = process.env. WAIT_FOR_BLOCK_MAX_ATTEMPTS || 160;

var getMaxBlockNumber = (rskClients) => {
  var maxBlockNumber;
  var result = Promise.resolve(0);
  rskClients.forEach(client => {
    result = result.then(() => client.eth.getBlockNumber())
      .then(bn => {
        maxBlockNumber = (maxBlockNumber == null || maxBlockNumber < bn) ? bn : maxBlockNumber;
        return maxBlockNumber;
      })
  });
  return result;
};

var waitForSync = (rskClients) => {
  return getMaxBlockNumber(rskClients).then(bn => {
    var result = Promise.resolve();
    rskClients.forEach(client => {
      result = result.then(() => waitForBlock(client, bn));
    });
    return result;
  });
};

var waitForBlock = (rskClient, blockNumber, waitTime = waitForBlockAttemptTimeMillis, maxAttempts = waitForBlockMaxAttempts) => {
  return new Promise((resolve, reject) => {
    var clearPoll;
    var attempts = 0;

    var checkBlockNumber = () => {
      rskClient.eth.getBlockNumber().then(bn => {
        if (bn >= blockNumber) {
          clearPoll();
          resolve(bn);
        }

        if (attempts++ === maxAttempts) {
          clearPoll();
          reject(new Error(`Block number ${blockNumber} never reached, last seen was ${bn}`));
        };
      }).catch((ex) => {
        reject("waitForBlock " + ex.stack);
      });
    }

    clearPoll = interval(checkBlockNumber, waitTime);
  });
};

var sendTxWithCheck = (rskClient) => (method, check, fromAddress) => () => {
    var txReceiptPromise = method.call({ from: fromAddress })
        .then(check)
        .then(() => method.estimateGas({ from: fromAddress }))
        .then((estimatedGas) =>
            method.send({ 
            from: fromAddress || getRandomFedChangeAddress(), 
            value: '0', 
            gasPrice: '0',
            gas: estimatedGas
        })
  );

  var mined = false;
  var mineTimeout;

  var executeMine = () => {
    mineTimeout = null;
    rskClient.evm.mine().then(() => wait(100)).then(() => {
      if (!mined) {
        mineTimeout = setTimeout(executeMine, 500);
      }
    });
  };

  // Mine until we get the tx receipt
  executeMine();

  return txReceiptPromise.then((txReceipt) => {
    mined = true;
    if (mineTimeout != null) {
      clearTimeout(mineTimeout);
    }
    return txReceipt;
  });
};

var triggerRelease = async(rskClients, btcClient, releaseCreatedCallback, releaseConfirmedCallback) => {
    const mineFunction = (amountOfBlocks) =>  btcClient.generate(amountOfBlocks);
    await triggerReleaseWithMineFunction(rskClients, mineFunction, releaseCreatedCallback, releaseConfirmedCallback);
};

var triggerRelease2 = async(rskClients, releaseCreatedCallback, releaseConfirmedCallback) => {
    const btcClient = btcClientProvider.getBtcClient();
    const mineFunction = (amountOfBlocks) =>  btcClient.nodeClient.mine(amountOfBlocks);
    await triggerReleaseWithMineFunction(rskClients, mineFunction, releaseCreatedCallback, releaseConfirmedCallback);
};

var triggerPegoutEvent = async(rskClients, releaseCreatedCallback, releaseConfirmedCallback) => {
  const isHop400AlreadyActive = await Runners.common.forks.hop400.isAlreadyActive();
  if (isHop400AlreadyActive) {
    await increaseBlockToNextPegoutHeight(rskClients[0]);
  }
  await triggerRelease2(rskClients, releaseCreatedCallback, releaseConfirmedCallback);
};

var triggerReleaseWithMineFunction = async(rskClients, mineFunction, releaseCreatedCallback, releaseConfirmedCallback) => {
    var rskClient = rskClients[0];
  
    // Sync all nodes
    await waitForSync(rskClients);
    // Trigger the coin selection for release
    await rskClient.fed.updateBridge(); 
    await rskClient.evm.mine();

    const pegoutCreationBlock = await rskClient.eth.getBlock("latest");
  
    if (releaseCreatedCallback) {
      await releaseCreatedCallback(rskClient);
    }
  
    // Confirm the coin selection
    await sequentialPromise(2, () => rskClient.evm.mine());
    await wait(3000);
    await rskClient.evm.mine()
    // Get the coin selection waiting for signatures + sync
    await rskClient.fed.updateBridge();
    await rskClient.evm.mine();
    
    if (releaseConfirmedCallback) { 
      await releaseConfirmedCallback(rskClient, pegoutCreationBlock.number);
    }
  
    await waitForSync(rskClients); 
    // Signal sign + sync + wait for sign txs to be output
    await rskClient.evm.mine();
    await waitForSync(rskClients);
    await wait(1000);
    // Mine signatures + sync
    await rskClient.evm.mine();
    await waitForSync(rskClients);
    // Release + sync + wait for btc tx to be output
    await rskClient.evm.mine();
    await waitForSync(rskClients);
    await wait(1000);
    // Mine the actual release transaction (+ 3 blocks more to get the change tx registered back)
    await mineFunction(1);
    await mineFunction(1);
    await mineFunction(1);
    await mineFunction(1);
    // Wait until change can go back to the Bridge
    await rskClient.fed.updateBridge();
    await rskClient.evm.mine();
    await waitForSync(rskClients);
    await wait(2500);
};

var sendFromCow = (rskClient) => (toAddress, amount) => {
  var initialAddressBalance;
  var cowAddress;
  amount = Number(amount);

  return Promise.resolve()
    .then(() => rskClient.eth.personal.newAccountWithSeed('cow'))
    .then((addr) => {
      cowAddress = addr;
    })
    .then(() => rskClient.eth.getBalance(toAddress))
    .then((balance) => {
      initialAddressBalance = Number(balance);
    })
    .then(() => {
      var txPromise = rskClient.eth.sendTransaction({
        from: cowAddress,
        to: toAddress,
        value: amount
      });
      return wait(1000).then(() => rskClient.evm.mine()).then(() => txPromise);
    })
    .then(() => rskClient.eth.getBalance(toAddress))
    .then((balance) => {
      expect(Number(balance)).to.equal(initialAddressBalance + amount);
    });
};

const waitForBtcToReturn = (btcClient, rskClient) => async (btcAddress) => {
  const btcStartBalances = await btcClient.getAddressBalance(btcAddress);
  const btcStartBalance = btcStartBalances[btcAddress];
  const MAX_WAIT = 20;
  for (let i = 0; i < MAX_WAIT; ++i) {
    await btcClient.generate(1);
    await rskClient.fed.updateBridge();
    await rskClient.evm.mine();
    const btcNewBalances = await btcClient.getAddressBalance(btcAddress);
    const btcNewBalance = btcNewBalances[btcAddress];
    if (btcNewBalance > btcStartBalance) {
      return btcNewBalance;
    }
  }
  throw new Error(`BTC haven't returned after ${MAX_WAIT} blocks`);
};

const getBridgeEventInBlockAndRunAssertions = async(block, eventName, eventAssertions, rsk, rskClient) => {
    const latestActiveForkName = await getLatestActiveForkName();
    const abi = getBridgeAbi(latestActiveForkName);

    let txs = block.transactions;
    let eventJson = abi.find((methods) => methods.name == eventName && methods.type == 'event');
    expect(eventJson, `Event with name "${eventName}" was not found in the "${latestActiveForkName}" abi`).to.not.be.undefined;
    let signature = rskClient.eth.abi.encodeEventSignature(eventJson);
    for (tx of txs) {
      let txReceipt = await rskClient.eth.getTransactionReceipt(tx);
      if (txReceipt.to == rsk.getBridgeAddress()){
        for (log of txReceipt.logs){
          if (log.topics[0] == signature) {
            let decodedLog = rskClient.eth.abi.decodeLog(eventJson.inputs, log.data, log.topics.slice(1));
            await eventAssertions(decodedLog, rskClient, { blockNumber: block.number, txHash: tx });
            return true;
          }
        }
      }
    }

    return false;
}

var getBridgeEventAndRunAssertions = (eventName, eventAssertions, rsk, maxPastBlocksToCheck) => async (rskClient, blocksDepth) => {
  var block = await rskClient.eth.getBlock("latest");
  if (!!blocksDepth) {
    block = await rskClient.eth.getBlock(block.number - blocksDepth);
  }

  let assertionRun = await getBridgeEventInBlockAndRunAssertions(block, eventName, eventAssertions, rsk, rskClient);

  if (!assertionRun) {
    maxPastBlocksToCheck = maxPastBlocksToCheck || 0;
    blocksDepth = blocksDepth || 0;
    if (maxPastBlocksToCheck > blocksDepth) {
      return getBridgeEventAndRunAssertions(eventName, eventAssertions, rsk, maxPastBlocksToCheck) (rskClient, blocksDepth + 1);
    }
    throw new Error('Conditions not reached');
  }
}

var getTransactionHashFromTxToBridge = async (functionName, rsk, rskClient) => {
  var abi = getBridgeAbi();
  var block = await rskClient.eth.getBlock("latest");
  var txs = block.transactions;
  var eventJson = abi.find((method) => method.name == functionName && method.type == 'function');
  expect(eventJson).to.not.be.undefined;
  var signature = rskClient.eth.abi.encodeFunctionSignature(eventJson);

  for (txHash of txs) {
    var txDetail = await rskClient.eth.getTransaction(txHash);
    if (txDetail.to == rsk.getBridgeAddress()){
      if (txDetail.input.startsWith(signature)){
        return txHash;
      }
    }
  }
}

const increaseBlockToNextPegoutHeight = async (rskClient) => {
    const nextPegoutCreationBlockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();
    const currentBlock = await rskClient.eth.getBlockNumber();
    const blocksNeededToReachHeight = nextPegoutCreationBlockNumber - currentBlock;
    await sequentialPromise(blocksNeededToReachHeight, () => rskClient.evm.mine());
}

module.exports = {
  with: (btcClient, rskClient) => ({
    sendTxWithCheck: sendTxWithCheck(rskClient),
    sendFromCow: sendFromCow(rskClient),
    waitForBtcToReturn: waitForBtcToReturn(btcClient, rskClient),
  }),
  waitForBlock: waitForBlock,
  waitForSync: waitForSync,
  getMaxBlockNumber: getMaxBlockNumber,
  triggerRelease: triggerRelease,
  triggerRelease2: triggerRelease2,
  getBridgeEventAndRunAssertions: getBridgeEventAndRunAssertions,
  getBridgeEventInBlockAndRunAssertions: getBridgeEventInBlockAndRunAssertions,
  getTransactionHashFromTxToBridge: getTransactionHashFromTxToBridge,
  increaseBlockToNextPegoutHeight,
  triggerPegoutEvent
};
