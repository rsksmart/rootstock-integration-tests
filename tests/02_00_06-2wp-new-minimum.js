const { expect } = require('chai');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getLatestForkName, activateFork, triggerRelease } = require('../lib/rsk-utils');
const { sendPegin, ensurePeginIsRegistered, sendTxToBridge, BRIDGE_ADDRESS, MIN_PEGOUT_VALUE_IN_RBTC } = require('../lib/2wp-utils');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { btcToSatoshis, btcToWeis, satoshisToBtc } = require('btc-eth-unit-converter');

describe('2wp after iris300, using new minimum values', () => {
    let rskTxHelpers;
    let btcTxHelper;
    let rskTxHelper;
    let minimumPeginValueInBTC;
    let bridge;
    let federationAddress;

    const fulfillRequirementsToRunAsSingleTestFile = async () => {
        const latestForkName = getLatestForkName()
        await activateFork(latestForkName);
    };

    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient();
  
        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile();
        };

        // Get the current peg-in minimum
        const latestActiveForkName = await getLatestActiveForkName();
        bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
        const minimumPeginValueInSatoshi = await bridge.methods.getMinimumLockTxValue().call();
        minimumPeginValueInBTC = satoshisToBtc(minimumPeginValueInSatoshi);

        //get federation address
        federationAddress = await bridge.methods.getFederationAddress().call();
    });
    
    it('should peg-in when sending minimum value', async () => {
        // Create legacy type address to use as sender
        const senderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
        const senderAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceInitial).to.equal(0);

        // Get the RSK address where the funds should be locked to
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(senderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
        const recipientRskAddressBalanceInitial = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(recipientRskAddressBalanceInitial).to.equal(0);

        await btcTxHelper.fundAddress(senderAddressInfo.address, minimumPeginValueInBTC + btcTxHelper.getFee());

        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const bridgeAddressBalanceInitial = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));

        // Execute peg-in
        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, minimumPeginValueInBTC);
        await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const expectedFederationAddressBalanceAfterPegin = federationAddressBalanceInitial + minimumPeginValueInBTC;
        expect(btcToSatoshis(federationAddressBalanceAfterPegin)).to.be.equal(btcToSatoshis(expectedFederationAddressBalanceAfterPegin));

        const bridgeAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));
        const expectedBridgeAddressBalanceAfterPegin = bridgeAddressBalanceInitial - btcToWeis(minimumPeginValueInBTC);
        expect(bridgeAddressBalanceAfterPegin).to.be.equal(expectedBridgeAddressBalanceAfterPegin)

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceFinal).to.equal(0);

        const recipientRskAddressBalanceFinal = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(recipientRskAddressBalanceFinal).to.equal(btcToWeis(minimumPeginValueInBTC));
    });

    it('should not peg-in and not refund when sending below minimum value', async () => {
        const BELOW_MIN_PEGIN_VALUE_IN_BTC = minimumPeginValueInBTC - 0.001

        // Create legacy type address to use as sender
        const senderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');

        await btcTxHelper.fundAddress(senderAddressInfo.address, BELOW_MIN_PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());

        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const bridgeAddressBalanceInitial = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));

        // Execute peg-in (pegin is not registered in the bridge -> Someone sent to the federation UTXOs amount less than minimum peg-in value)
        await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, BELOW_MIN_PEGIN_VALUE_IN_BTC);

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const expectedFederationAddressBalanceAfterPegin = federationAddressBalanceInitial + BELOW_MIN_PEGIN_VALUE_IN_BTC;
        expect(btcToSatoshis(federationAddressBalanceAfterPegin)).to.be.equal(btcToSatoshis(expectedFederationAddressBalanceAfterPegin));

        const bridgeAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));
        expect(bridgeAddressBalanceAfterPegin).to.be.equal(bridgeAddressBalanceInitial);

        const senderAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceAfterPegin).to.be.equal(0);
        
        await triggerRelease(rskTxHelpers, btcTxHelper);

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceFinal).to.be.equal(0);

        const federationAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const expectedFederationAddressBalanceFinal = federationAddressBalanceInitial + BELOW_MIN_PEGIN_VALUE_IN_BTC;
        expect(btcToSatoshis(federationAddressBalanceFinal)).to.be.equal(btcToSatoshis(expectedFederationAddressBalanceFinal));

        const bridgeAddressBalanceFinal = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));
        expect(bridgeAddressBalanceFinal).to.be.equal(bridgeAddressBalanceInitial)
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
        expect(recipientRskAddressBalanceAfterPegin).to.be.equal(btcToWeis(minimumPeginValueInBTC));

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const expectedFederationAddressBalanceAfterPegin = federationAddressBalanceInitial + minimumPeginValueInBTC;
        expect(btcToSatoshis(federationAddressBalanceAfterPegin)).to.be.equal(btcToSatoshis(expectedFederationAddressBalanceAfterPegin));

        // Execute peg-out
        await sendTxToBridge(rskTxHelper, MIN_PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);
        await triggerRelease(rskTxHelpers, btcTxHelper);

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        const maxExpectedSenderAddressBalanceFinal = btcToSatoshis(MIN_PEGOUT_VALUE_IN_RBTC);
        const minExpectedSenderAddressBalanceFinal = btcToSatoshis(MIN_PEGOUT_VALUE_IN_RBTC - TX_FEE_IN_RBTC);
        expect(btcToSatoshis(senderAddressBalanceFinal)).to.be.above(minExpectedSenderAddressBalanceFinal).and.below(maxExpectedSenderAddressBalanceFinal);

        const federationAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const expectedFederationAddressBalanceFinal = federationAddressBalanceAfterPegin - MIN_PEGOUT_VALUE_IN_RBTC;
        expect(btcToSatoshis(federationAddressBalanceFinal)).to.be.equal(btcToSatoshis(expectedFederationAddressBalanceFinal));

        const recipientRskAddressBalanceFinal = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        const maxExpectedRecipientRskAddressBalanceFinal = btcToWeis(minimumPeginValueInBTC - MIN_PEGOUT_VALUE_IN_RBTC);
        const minExpectedRecipientRskAddressBalanceFinal = btcToWeis(minimumPeginValueInBTC - MIN_PEGOUT_VALUE_IN_RBTC - TX_FEE_IN_RBTC);
        expect(recipientRskAddressBalanceFinal).to.be.above(minExpectedRecipientRskAddressBalanceFinal).and.below(maxExpectedRecipientRskAddressBalanceFinal);
    });
});
