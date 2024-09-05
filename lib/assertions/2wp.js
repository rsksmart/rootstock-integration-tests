const expect = require('chai').expect;
var {wait, removePrefix0x} = require('../utils');
var bitcoin = require('peglib').bitcoin;
var rsk = require('peglib').rsk;
const {MAX_ESTIMATED_FEE_PER_PEGOUT, FEE_DIFFERENCE_PER_PEGOUT} = require('../constants');
const {encodeOutpointValuesAsMap, decodeOutpointValues} = require("../varint");

const BTC_TX_FEE = bitcoin.btcToSatoshis(0.001);

/**
 * @deprecated
 * @param {object} btcClient
 * @param {object} rskClient
 * @param {object} pegClient
 * @returns {void}
 */
var assertBitcoinBalance = (btcClient, rskClient, pegClient) => (btcAddress, expectedBalance, message) => {
  return btcClient.getAddressBalance(btcAddress).then((btcBalances) => {
    const currentBtcBalance = btcBalances[btcAddress] || 0;
    expect(currentBtcBalance, message).to.equal(expectedBalance)
  })
};

var assertLock = (btcClient, rskClient, pegClient) => (fromAddresses, outputs, options) => {
  options = Object.assign({}, {
    shouldMineAndUpdatePrematurely: false,
    fails: false
  }, options);

  var initialBlockNumber;
  var initialFederationBalances, initialBtcBalance, initialRskBalance, expectedFederationBalances;
  var federationAddresses = Object.keys(outputs.reduce((ad, output) => ({...ad, [output.address]: true}), {}));
  amount = outputs.reduce((t, o) => t + o.amount, 0);

  return Promise.resolve()
    .then(() => btcClient.getAddressBalance(federationAddresses)).then((btcBalances) => {
      initialFederationBalances = federationAddresses.reduce((balances, address) => {
        balances[address] = (balances[address] || 0) + (btcBalances[address] || 0);
        return balances;
      }, {});
      expectedFederationBalances = Object.assign({}, initialFederationBalances);
      outputs.forEach(output => {
        expectedFederationBalances[output.address] += output.amount;
      });
    })
    .then(() => btcClient.getAddressBalance(fromAddresses.btc)).then((btcBalances) => {
      initialBtcBalance = btcBalances[fromAddresses.btc] || 0;
    })
    .then(async () => {
      if (!isMultisig(fromAddresses)) {
        let currentRskBalance = await rskClient.eth.getBalance(fromAddresses.rsk);
        const currentRskBalanceInSatoshis = rsk.weisToSatoshis(currentRskBalance);
        initialRskBalance = currentRskBalanceInSatoshis;
      }
    })
    .then(() => isMultisig(fromAddresses) ? btcClient.sendFromMultisigTo(fromAddresses, outputs, BTC_TX_FEE, 1) : btcClient.sendFromTo(fromAddresses.btc, outputs, BTC_TX_FEE, 1))
    .then(() => mineAndUpdate(btcClient, rskClient, options.shouldMineAndUpdatePrematurely))
    .then(() => btcClient.generate(3))
    .then(() => assertBitcoinBalance(btcClient, rskClient, pegClient)(fromAddresses.btc, initialBtcBalance - amount - BTC_TX_FEE, 'Lock BTC debit'))
    .then(() => {
      var result = Promise.resolve();
      federationAddresses.forEach((address) => {
        result = result.then(() => assertBitcoinBalance(btcClient, rskClient, pegClient)(address, expectedFederationBalances[address], `Lock BTC federation ${address} credit`))
      })
      return result;
    })
    .then(() => wait(500))
    .then(() => rskClient.fed.updateBridge())
    .then(() => rskClient.evm.mine())
    .then(() => rskClient.eth.getBlockNumber())
    .then((currentBlockNumber) => {
      initialBlockNumber = currentBlockNumber;
    })
    .then(() => rskClient.evm.mine())
    .then(() => rskClient.eth.getBlockNumber())
    .then((currentBlockNumber) => {
      expect(currentBlockNumber).to.equal(initialBlockNumber + 1);
    })
    .then(async () => {
      if (!isMultisig(fromAddresses)) {
        let currentRskBalance = await rskClient.eth.getBalance(fromAddresses.rsk);
        const currentRskBalanceInSatoshis = rsk.weisToSatoshis(currentRskBalance);
        if (options.fails) {
          expect(currentRskBalanceInSatoshis, 'Wrong RSK balance').to.equal(initialRskBalance);
        } else {
          expect(currentRskBalanceInSatoshis, 'Wrong RSK balance').to.equal(Number(initialRskBalance) + Number(amount));
        }
      }
    });
};

var mineAndUpdate = (btcClient, rskClient, doIt) => {
  var result = Promise.resolve();
  if (doIt) {
    result = result
      .then(() => btcClient.generate(1))
      .then(() => wait(500))
      .then(() => rskClient.fed.updateBridge())
      .then(() => rskClient.evm.mine())
      .then(() => wait(500));
  }
  return result;
};

let isMultisig = (addr) => (addr.info && addr.info.type == 'multisig');

const assertCallToPegoutBatchingBridgeMethods = (rskClient) => async (expectedCount, expectedNextPegoutCreationBlockNumber) => {
  const count = await rskClient.rsk.bridge.methods.getQueuedPegoutsCount().call();
  expect(Number(count)).to.equal(expectedCount);

  const estimatedFees = await rskClient.rsk.bridge.methods.getEstimatedFeesForNextPegOutEvent().call();
  // Using Arithmetic Sequence To Calculate The Estimated Fee
  // With the 'running with all forks active', the estimated fees are always calculated.
  const expectedEstimatedFee = MAX_ESTIMATED_FEE_PER_PEGOUT + (expectedCount - 1) * FEE_DIFFERENCE_PER_PEGOUT;
  expect(Number(estimatedFees)).to.equal(expectedEstimatedFee);

  const nextPegoutCreationBlockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();
  expect(Number(nextPegoutCreationBlockNumber)).to.equal(expectedNextPegoutCreationBlockNumber);
}

const assertRejectedPeginEvent = async (rejectedPeginTx, expectedRejectionReason, expectedPeginBtcHash, expectedRefundAmountInSatoshis) => {
  const rejectedPeginEvent = rejectedPeginTx.events[0];
  expect(rejectedPeginEvent).to.not.be.null;
  expect(rejectedPeginEvent.arguments.btcTxHash).to.equal(expectedPeginBtcHash);
  expect(rejectedPeginEvent.arguments.reason).to.equal(expectedRejectionReason);

  const pegoutRequestedEvent = rejectedPeginTx.events[1];
  expect(pegoutRequestedEvent).to.not.be.null;

  // TODO: remove this check when lovell is active by default like the other forks.
  const isLovellAlreadyActive = await Runners.common.forks.lovell700.isAlreadyActive();
  if(isLovellAlreadyActive) {
    const pegoutTransactionCreatedEvent = rejectedPeginTx.events[2];
    expect(pegoutTransactionCreatedEvent).to.not.be.null;
    const encodedUtxoOutpointValues = Buffer.from(removePrefix0x(pegoutTransactionCreatedEvent.arguments.utxoOutpointValues), 'hex');
    const federationUtxoValues = encodeOutpointValuesAsMap([{"valueInSatoshis": expectedRefundAmountInSatoshis}]);
    const outpointValues = decodeOutpointValues(encodedUtxoOutpointValues);
    expect(outpointValues.every(value => value in federationUtxoValues)).to.be.true;
  }

}

module.exports = {
  with: (btcClient, rskClient, pegClient) => ({
    assertBitcoinBalance: assertBitcoinBalance(btcClient, rskClient, pegClient),
    assertLock: assertLock(btcClient, rskClient, pegClient),
  }),
  assertCallToPegoutBatchingBridgeMethods,
  assertRejectedPeginEvent
};
