const expect = require('chai').expect
const { satoshisToBtc } = require('@rsksmart/btc-eth-unit-converter');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { sendPegin } = require('../lib/2wp-utils');
const { getBridge } = require('../lib/precompiled-abi-forks-util');
const { isUtxoRegisteredInBridge } = require('../lib/2wp-utils');

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;

describe('Peg-in multisig address', () => {
    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient()
    });

    // Should fail and not refund when sending a pengin from a multisig address pre papyrus
    it('Peg-in should fail when using multisig address', async () => {
        const bridge = getBridge(rskTxHelper.getClient());

        const minimumPeginValueInSatoshis = await bridge.methods.getMinimumLockTxValue().call();
        const minimumPeginValueInBtc = Number(satoshisToBtc(minimumPeginValueInSatoshis));

        const federationAddress = await bridge.methods.getFederationAddress().call();
        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

        const senderAddress = await btcTxHelper.generateMultisigAddress(3, 2, 'legacy');
        await btcTxHelper.fundAddress(senderAddress.address, minimumPeginValueInBtc + btcTxHelper.getFee());

        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddress, minimumPeginValueInBtc);

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(Number(federationAddressBalanceAfterPegin)).to.be.equal(Number(federationAddressBalanceInitial + minimumPeginValueInBtc));

        const isPeginUtxoRegistered = await isUtxoRegisteredInBridge(rskTxHelper, btcPeginTxHash);
        expect(isPeginUtxoRegistered).to.be.false;

        const federationAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(Number(federationAddressBalanceFinal)).to.be.equal(Number(federationAddressBalanceInitial + minimumPeginValueInBtc));

        const senderAddressBalanceFinal = await btcTxHelper.getAddressBalance(senderAddress.address);
        expect(Number(senderAddressBalanceFinal)).to.be.equal(0);
    });
});

