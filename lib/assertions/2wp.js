const expect = require('chai').expect;
const BN = require('bn.js');
const { get2wpBalances, getActiveFederationUtxos, getOldFederationUtxos } = require('../2wp-utils');
const { satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const {
    getBtcTxBlockHeight,
    getInputSpentTxHash,
    waitForBitcoinTxToBeInMempool,
} = require('../btc-utils');

/**
 * Gets the final 2wp balances (Federations, Bridge utxos and bridge rsk balances) and compares them to the `initial2wpBalances` to assert the expected values based on a successful pegin.
 * Checks that after a successful pegin, the federation and Bridge utxos balances are increased and the Bridge rsk balance is decreased, by the `peginValueInSatoshis` amount.
 * @param {{federationAddressBalanceInSatoshis: number, retiringFederationAddressBalanceInSatoshis: number, bridgeUtxosBalanceInSatoshis: number, bridgeBalanceInWeisBN: BN}} initial2wpBalances
 * @param {number} peginValueInSatoshis the value of the pegin in satoshis by which the 2wp balances are expected to be updated
 * @returns {Promise<void>}
 */
const assert2wpBalancesAfterSuccessfulPegin = async (
    rskTxHelper,
    btcTxHelper,
    initial2wpBalances,
    peginValueInSatoshis
) => {
    const final2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
    const initialFederationsBalancesInSatoshis =
        initial2wpBalances.federationAddressBalanceInSatoshis +
        initial2wpBalances.retiringFederationAddressBalanceInSatoshis;
    const finalFederationsBalancesInSatoshis =
        final2wpBalances.federationAddressBalanceInSatoshis +
        final2wpBalances.retiringFederationAddressBalanceInSatoshis;

    expect(finalFederationsBalancesInSatoshis).to.be.equal(
        initialFederationsBalancesInSatoshis + peginValueInSatoshis
    );

    expect(final2wpBalances.bridgeUtxosBalanceInSatoshis).to.be.equal(
        initial2wpBalances.bridgeUtxosBalanceInSatoshis + peginValueInSatoshis
    );

    const expectedFinalBridgeBalancesInWeisBN = initial2wpBalances.bridgeBalanceInWeisBN.sub(
        new BN(satoshisToWeis(peginValueInSatoshis))
    );
    expect(final2wpBalances.bridgeBalanceInWeisBN.eq(expectedFinalBridgeBalancesInWeisBN)).to.be
        .true;
};

/**
 * Asserts that the utxos registered in the active federation utxos for `btcTxHash` are exactly the `expectedUtxos`.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} btcTxHash
 * @param {Utxo[]} expectedUtxos
 * @returns {Promise<void>}
 */
const assertUtxosAreRegisteredInActiveFederationUtxos = async (
    rskTxHelper,
    btcTxHash,
    expectedUtxos
) => {
    const activeFederationUtxos = await getActiveFederationUtxos(rskTxHelper);
    assertBtcTxUtxosAreInFederationUtxos(activeFederationUtxos, btcTxHash, expectedUtxos);
};

/**
 * Asserts that the utxos registered in the old federation utxos for `btcTxHash` are exactly the `expectedUtxos`.
 * @param {RskTransactionHelper} rskTxHelper
 * @param {string} btcTxHash
 * @param {Utxo[]} expectedUtxos
 * @returns {Promise<void>}
 */
const assertUtxosAreRegisteredInOldFederationUtxos = async (
    rskTxHelper,
    btcTxHash,
    expectedUtxos
) => {
    const oldFederationUtxos = await getOldFederationUtxos(rskTxHelper);
    assertBtcTxUtxosAreInFederationUtxos(oldFederationUtxos, btcTxHash, expectedUtxos);
};

const assertBtcTxUtxosAreInFederationUtxos = (federationUtxos, btcTxHash, expectedUtxos) => {
    const registeredUtxos = federationUtxos.filter((utxo) => utxo.btcTxHash === btcTxHash);
    expect(registeredUtxos).to.be.deep.equal(
        expectedUtxos,
        `The utxos of ${btcTxHash} should be registered with their hash, output index, value and height.`
    );
};

/**
 * Asserts that the btc transaction was mined in the block at `expectedHeight`.
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {string} btcTxHash
 * @param {number} expectedHeight
 * @returns {Promise<void>}
 */
const assertBtcTxIsMinedAtHeight = async (btcTxHelper, btcTxHash, expectedHeight) => {
    const btcTxBlockHeight = await getBtcTxBlockHeight(btcTxHelper, btcTxHash);
    expect(btcTxBlockHeight).to.be.equal(
        expectedHeight,
        `The btc tx ${btcTxHash} should be mined at height ${expectedHeight}.`
    );
};

/**
 * Asserts that the btc transaction reaches the bitcoin mempool, waiting for it up to 20 seconds.
 * @param {BtcTransactionHelper} btcTxHelper
 * @param {string} btcTxHash
 * @returns {Promise<void>}
 */
const assertBtcTxReachesMempool = async (btcTxHelper, btcTxHash) => {
    const maxAttempts = 20;
    const checkEveryMilliseconds = 1000;
    const btcTxIsInMempool = await waitForBitcoinTxToBeInMempool(
        btcTxHelper,
        btcTxHash,
        maxAttempts,
        checkEveryMilliseconds
    );
    expect(btcTxIsInMempool, `The btc tx ${btcTxHash} should reach the bitcoin mempool.`).to.be
        .true;
};

/**
 * Asserts that none of the utxos spent by `btcTransaction` are in `federationUtxos`.
 * @param {Utxo[]} federationUtxos
 * @param {bitcoinJsLib.Transaction} btcTransaction
 * @returns {void}
 */
const assertSpentUtxosNotAvailableAnyMore = (federationUtxos, btcTransaction) => {
    for (const input of btcTransaction.ins) {
        const inputTxHash = getInputSpentTxHash(input);
        const spentUtxoInFederationUtxos = federationUtxos.find(
            (utxo) => utxo.btcTxHash === inputTxHash && utxo.btcTxOutputIndex === input.index
        );
        expect(
            spentUtxoInFederationUtxos,
            `The utxo ${inputTxHash}:${input.index} spent by the btc tx ${btcTransaction.getId()} should not be in the federation utxos.`
        ).to.be.undefined;
    }
};

module.exports = {
    assert2wpBalancesAfterSuccessfulPegin,
    assertUtxosAreRegisteredInActiveFederationUtxos,
    assertUtxosAreRegisteredInOldFederationUtxos,
    assertSpentUtxosNotAvailableAnyMore,
    assertBtcTxIsMinedAtHeight,
    assertBtcTxReachesMempool,
};
