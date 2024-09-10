const expect = require('chai').expect
const { satoshisToBtc } = require('@rsksmart/btc-eth-unit-converter');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { sendPegin } = require('../lib/2wp-utils');
const { getBridge } = require('../lib/precompiled-abi-forks-util');

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;

describe('Lock multisig address', () => {
    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient()
    });

    // Should refund if the btc sender address is a multisig
    it('lock should work when using multisig address', async () => {
        const bridge = getBridge(rskTxHelper.getClient());
        
        const minimumPeginValueInSatoshis = await bridge.methods.getMinimumLockTxValue().call();
        const minimumPeginValueInBtc = Number(satoshisToBtc(minimumPeginValueInSatoshis));

        const federationAddress = await bridge.methods.getFederationAddress().call();
        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

        const senderAddressInfo = await btcTxHelper.generateMultisigAddress(3, 2, 'legacy');
        await btcTxHelper.fundAddress(senderAddressInfo.address, minimumPeginValueInBtc + btcTxHelper.getFee());
        await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, minimumPeginValueInBtc);

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(Number(federationAddressBalanceAfterPegin)).to.be.equal(Number(federationAddressBalanceInitial + minimumPeginValueInBtc))

        const senderAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0)

        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        const finalFederationAddressBalance = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(Number(finalFederationAddressBalance)).to.be.equal(Number(federationAddressBalanceInitial))
        
        const finalSenderAddressBalance = await btcTxHelper.getAddressBalance(senderAddressInfo.address);
        expect(Number(finalSenderAddressBalance)).to.be.above(minimumPeginValueInBtc - btcTxHelper.getFee()).and.below(minimumPeginValueInBtc)
    });
});
