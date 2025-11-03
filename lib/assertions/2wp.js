const expect = require('chai').expect;
const BN = require('bn.js');
const {wait} = require('../utils');
const bitcoin = require('peglib').bitcoin;
const rsk = require('peglib').rsk;
const {
  get2wpBalances,
} = require('../2wp-utils');
const { satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');

const { MAX_ESTIMATED_FEE_PER_PEGOUT, FEE_DIFFERENCE_PER_PEGOUT } = require('../constants/pegout-constants');

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
      for (const output of outputs) {
        expectedFederationBalances[output.address] += output.amount;
      }
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
      for (const address of federationAddresses) {
        result = result.then(() => assertBitcoinBalance(btcClient, rskClient, pegClient)(address, expectedFederationBalances[address], `Lock BTC federation ${address} credit`))
      }
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
  const expectedEstimatedFee = expectedCount > 0 ? MAX_ESTIMATED_FEE_PER_PEGOUT + (expectedCount - 1) * FEE_DIFFERENCE_PER_PEGOUT : 0;
  expect(Number(estimatedFees)).to.equal(expectedEstimatedFee);

  const nextPegoutCreationBlockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();
  expect(Number(nextPegoutCreationBlockNumber)).to.equal(expectedNextPegoutCreationBlockNumber);
}

/**
 * Gets the final 2wp balances (Federations, Bridge utxos and bridge rsk balances) and compares them to the `initial2wpBalances` to assert the expected values based on a successful pegin.
 * Checks that after a successful pegin, the federation and Bridge utxos balances are increased and the Bridge rsk balance is decreased, by the `peginValueInSatoshis` amount.
 * @param {{federationAddressBalanceInSatoshis: number, retiringFederationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}} initial2wpBalances
 * @param {number} peginValueInSatoshis the value of the pegin in satoshis by which the 2wp balances are expected to be updated
 * @returns {Promise<void>}
 */
const assert2wpBalancesAfterSuccessfulPegin = async (rskTxHelper, btcTxHelper, initial2wpBalances, peginValueInSatoshis) => {
  
  const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
  const initialFederationsBalancesInSatoshis = initial2wpBalances.federationAddressBalanceInSatoshis + initial2wpBalances.retiringFederationAddressBalanceInSatoshis;
  const finalFederationsBalancesInSatoshis = final2wpBalances.federationAddressBalanceInSatoshis + final2wpBalances.retiringFederationAddressBalanceInSatoshis;

  expect(finalFederationsBalancesInSatoshis).to.be.equal((initialFederationsBalancesInSatoshis) + peginValueInSatoshis);

  expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(initial2wpBalances.bridgeUtxosBalanceInSatoshis + peginValueInSatoshis);

  const expectedFinalBridgeBalancesInWeisBN = initial2wpBalances.bridgeBalanceInWeisBN.sub(new BN(satoshisToWeis(peginValueInSatoshis)));
  expect(final2wpBalances.bridgeBalanceInWeisBN.eq(expectedFinalBridgeBalancesInWeisBN)).to.be.true;

};

module.exports = {
  with: (btcClient, rskClient, pegClient) => ({
    assertBitcoinBalance: assertBitcoinBalance(btcClient, rskClient, pegClient),
    assertLock: assertLock(btcClient, rskClient, pegClient),
  }),
  assertCallToPegoutBatchingBridgeMethods,
  assert2wpBalancesAfterSuccessfulPegin,
};
