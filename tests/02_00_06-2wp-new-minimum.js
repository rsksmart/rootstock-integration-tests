const { expect } = require('chai');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { triggerRelease } = require('../lib/rsk-utils');
const { sendPegin, ensurePeginIsRegistered, sendTxToBridge, BRIDGE_ADDRESS, MIN_PEGOUT_VALUE_IN_RBTC } = require('../lib/2wp-utils');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const { getBridge } = require('../lib/precompiled-abi-forks-util');
const { btcToSatoshis, btcToWeis, satoshisToBtc } = require('@rsksmart/btc-eth-unit-converter');

describe('2wp after iris300, using new minimum values', () => {
    let rskTxHelpers;
    let btcTxHelper;
    let rskTxHelper;
    let minimumPeginValueInBTC;
    let bridge;
    let federationAddress;

    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient();
  
        // Get the current peg-in minimum
        bridge = getBridge(rskTxHelper.getClient());
        const minimumPeginValueInSatoshi = await bridge.methods.getMinimumLockTxValue().call();
        minimumPeginValueInBTC = Number(satoshisToBtc(minimumPeginValueInSatoshi));

        //get federation address
        federationAddress = await bridge.methods.getFederationAddress().call();
    });
    
    it('should peg-out successfully when sending exactly the minimum pegout value', async () => {
        // Do a peg-in first to ensure the federation has funds to do the peg-out
        const TX_FEE_IN_RBTC = 0.001;

        // Create legacy type address to use as sender
        const senderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');

        await btcTxHelper.fundAddress(senderAddressInfo.address, minimumPeginValueInBTC + btcTxHelper.getFee());

        // Get the RSK address where the funds should be locked to
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(senderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
        await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
        const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
        expect(unlocked, 'Account was not unlocked').to.be.true;
        const recipientRskAddressBalanceInitial = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(recipientRskAddressBalanceInitial).to.be.equal(0);

        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

        // Execute peg-in
        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, minimumPeginValueInBTC);
        await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

        const recipientRskAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(recipientRskAddressBalanceAfterPegin).to.be.equal(Number(btcToWeis(minimumPeginValueInBTC)));

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const expectedFederationAddressBalanceAfterPegin = federationAddressBalanceInitial + minimumPeginValueInBTC;
        expect(Number(btcToSatoshis(federationAddressBalanceAfterPegin))).to.be.equal(Number(btcToSatoshis(expectedFederationAddressBalanceAfterPegin)));

        // Execute peg-out
        await sendTxToBridge(rskTxHelper, MIN_PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);
        await triggerRelease(rskTxHelpers, btcTxHelper);

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        const maxExpectedSenderAddressBalanceFinal = Number(btcToSatoshis(MIN_PEGOUT_VALUE_IN_RBTC));
        const minExpectedSenderAddressBalanceFinal = Number(btcToSatoshis(MIN_PEGOUT_VALUE_IN_RBTC - TX_FEE_IN_RBTC));
        expect(Number(btcToSatoshis(senderAddressBalanceFinal))).to.be.above(minExpectedSenderAddressBalanceFinal).and.below(maxExpectedSenderAddressBalanceFinal);

        const federationAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const expectedFederationAddressBalanceFinal = federationAddressBalanceAfterPegin - MIN_PEGOUT_VALUE_IN_RBTC;
        expect(Number(btcToSatoshis(federationAddressBalanceFinal))).to.be.equal(Number(btcToSatoshis(expectedFederationAddressBalanceFinal)));

        const recipientRskAddressBalanceFinal = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        const maxExpectedRecipientRskAddressBalanceFinal = Number(btcToWeis(minimumPeginValueInBTC - MIN_PEGOUT_VALUE_IN_RBTC));
        const minExpectedRecipientRskAddressBalanceFinal = Number(btcToWeis(minimumPeginValueInBTC - MIN_PEGOUT_VALUE_IN_RBTC - TX_FEE_IN_RBTC));
        expect(recipientRskAddressBalanceFinal).to.be.above(minExpectedRecipientRskAddressBalanceFinal).and.below(maxExpectedRecipientRskAddressBalanceFinal);
    });
});
