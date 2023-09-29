const { expect } = require('chai');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const rskUtils = require('../lib/rsk-utils');
const { sendPegin, ensurePeginIsRegistered, sendTxToBridge, BRIDGE_ADDRESS, MIN_PEGOUT_VALUE_IN_RBTC } = require('../lib/2wp-utils');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const btcEthUnitConverter = require('btc-eth-unit-converter');

describe('2wp after iris300, using new minimum values', () => {
    let rskTxHelpers;
    let btcTxHelper;
    let rskTxHelper;
    let minimumPeginValueInBTC;
    let bridge;
    let federationAddress;

    const fulfillRequirementsToRunAsSingleTestFile = async () => {
        const latestForkName = rskUtils.getLatestForkName()
        await rskUtils.activateFork(latestForkName);
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
        minimumPeginValueInBTC = btcEthUnitConverter.satoshisToBtc(minimumPeginValueInSatoshi);

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
        expect(federationAddressBalanceAfterPegin).to.be.equal(Number(federationAddressBalanceInitial + minimumPeginValueInBTC));

        const bridgeAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));
        expect(bridgeAddressBalanceAfterPegin).to.be.equal(bridgeAddressBalanceInitial - btcEthUnitConverter.btcToWeis(minimumPeginValueInBTC))

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceFinal).to.equal(0);

        const recipientRskAddressBalanceFinal = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(recipientRskAddressBalanceFinal).to.equal(btcEthUnitConverter.btcToWeis(minimumPeginValueInBTC));
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
        expect(btcEthUnitConverter.btcToSatoshis(federationAddressBalanceAfterPegin)).to.be.equal(btcEthUnitConverter.btcToSatoshis(federationAddressBalanceInitial + BELOW_MIN_PEGIN_VALUE_IN_BTC));

        const bridgeAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(BRIDGE_ADDRESS));
        expect(bridgeAddressBalanceAfterPegin).to.be.equal(bridgeAddressBalanceInitial);

        const senderAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceAfterPegin).to.be.equal(0);
        
        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceFinal).to.be.equal(0);

        const federationAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(btcEthUnitConverter.btcToSatoshis(federationAddressBalanceFinal)).to.be.equal(btcEthUnitConverter.btcToSatoshis(federationAddressBalanceInitial + BELOW_MIN_PEGIN_VALUE_IN_BTC));

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
        expect(recipientRskAddressBalanceAfterPegin).to.be.equal(btcEthUnitConverter.btcToWeis(minimumPeginValueInBTC));

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(federationAddressBalanceAfterPegin).to.be.equal(Number(federationAddressBalanceInitial + minimumPeginValueInBTC));

        // Execute peg-out
        await sendTxToBridge(rskTxHelper, MIN_PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);
        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceFinal).to.be.above(MIN_PEGOUT_VALUE_IN_RBTC - TX_FEE_IN_RBTC).and.below(MIN_PEGOUT_VALUE_IN_RBTC);

        const federationAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(federationAddressBalanceFinal).to.be.equal(Number(federationAddressBalanceAfterPegin - MIN_PEGOUT_VALUE_IN_RBTC));
       
        const recipientRskAddressBalanceFinal = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(recipientRskAddressBalanceFinal).to.be.above(btcEthUnitConverter.btcToWeis(minimumPeginValueInBTC - MIN_PEGOUT_VALUE_IN_RBTC - TX_FEE_IN_RBTC)).and.below(btcEthUnitConverter.btcToWeis(minimumPeginValueInBTC - MIN_PEGOUT_VALUE_IN_RBTC));
    });
});

