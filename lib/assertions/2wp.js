const expect = require('chai').expect;
const BN = require('bn.js');
const { get2wpBalances } = require('../2wp-utils');
const { satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');

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

module.exports = {
    assert2wpBalancesAfterSuccessfulPegin,
};
