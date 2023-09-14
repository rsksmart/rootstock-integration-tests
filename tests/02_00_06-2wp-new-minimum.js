const { expect } = require('chai');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const rskUtils = require('../lib/rsk-utils');
const { sendPegin, ensurePeginIsRegistered, sendTxToBridge } = require('../lib/2wp-utils');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const whitelistingAssertions = require('../lib/assertions/whitelisting');
const btcEthUnitConverter = require('btc-eth-unit-converter');

describe('2wp after iris300, using new minimum values', () => {
    let rskTxHelpers;
    let btcTxHelper;
    let rskTxHelper;
    let MINIMUM_PEGIN_VALUE_IN_SATOSHI;
    let MINIMUM_PEGIN_VALUE_IN_BTC;
    let bridge;

    const fulfillRequirementsToRunAsSingleTestFile = async () => {
        await rskUtils.activateFork(Runners.common.forks.fingerroot500);
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
        MINIMUM_PEGIN_VALUE_IN_SATOSHI = await bridge.methods.getMinimumLockTxValue().call();
        MINIMUM_PEGIN_VALUE_IN_BTC = btcEthUnitConverter.satoshisToBtc(MINIMUM_PEGIN_VALUE_IN_SATOSHI);
    });
    
    it('should peg-in when sending minimum value', async () => {
        // Create legacy type address to use as sender
        const senderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
        await whitelistingAssertions.assertAddLimitedLockWhitelistAddress(rskTxHelper, senderAddressInfo.address, MINIMUM_PEGIN_VALUE_IN_SATOSHI);
        await rskUtils.mineAndSync(rskTxHelpers);
        const senderAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));

        // Get the RSK address where the funds should be locked to
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(senderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
        const recipientRskAddressBalanceInitial = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));

        await btcTxHelper.fundAddress(senderAddressInfo.address, MINIMUM_PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());
        
        // Execute peg-in
        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, MINIMUM_PEGIN_VALUE_IN_BTC);
        await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

        // Assert
        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        const recipientRskAddressBalanceFinal = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));

        expect(Number(senderAddressBalanceInitial)).to.equal(0);
        expect(Number(recipientRskAddressBalanceInitial)).to.equal(0);
        expect(Number(senderAddressBalanceFinal)).to.equal(0);
        expect(Number(recipientRskAddressBalanceFinal)).to.equal(btcEthUnitConverter.btcToWeis(MINIMUM_PEGIN_VALUE_IN_BTC));
    });

    it('should not peg-in and not refund when sending below minimum value', async () => {
        const PEGIN_VALUE_IN_BTC = MINIMUM_PEGIN_VALUE_IN_BTC - 0.001

        // Create legacy type address to use as sender
        const senderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
        await whitelistingAssertions.assertAddLimitedLockWhitelistAddress(rskTxHelper, senderAddressInfo.address, MINIMUM_PEGIN_VALUE_IN_SATOSHI);
        await rskUtils.mineAndSync(rskTxHelpers);

        await btcTxHelper.fundAddress(senderAddressInfo.address, PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());

        //get federation address
        const federationAddress = await bridge.methods.getFederationAddress().call();
        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

        // Execute peg-in (pegin is not registered in the bridge -> Someone sent to the federation UTXOs amount less than 50000000 satoshis)
        await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, PEGIN_VALUE_IN_BTC);

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        
        const senderAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        
        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));

        const federationAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(federationAddress));
        
        expect(Number(federationAddressBalanceAfterPegin)).to.be.equal(Number(federationAddressBalanceInitial + PEGIN_VALUE_IN_BTC));
        expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);
        expect(Number(senderAddressBalanceFinal)).to.be.equal(0);
        expect(Number(federationAddressBalanceFinal)).to.be.equal(Number(federationAddressBalanceInitial + PEGIN_VALUE_IN_BTC));
    });

    it('should peg-out successfully when sending exactly the minimum pegout value', async () => {
        // Do a peg-in first to ensure the federation has funds to do the peg-out
        const PEGIN_VALUE_IN_BTC = 1;
        const MIN_PEGOUT_VALUE_IN_RBTC = 0.0025;
        const TX_FEE_IN_RBTC = 0.001;

        // Create legacy type address to use as sender
        const senderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
        await whitelistingAssertions.assertAddLimitedLockWhitelistAddress(rskTxHelper, senderAddressInfo.address, btcEthUnitConverter.btcToSatoshis(PEGIN_VALUE_IN_BTC));
        await rskUtils.mineAndSync(rskTxHelpers);

        await btcTxHelper.fundAddress(senderAddressInfo.address, PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());

        // Get the RSK address where the funds should be locked to
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(senderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
        await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
        const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
        expect(unlocked, 'Account was not unlocked').to.be.true;
        const recipientRskAddressBalanceInitial = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));

        // Execute peg-in
        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, PEGIN_VALUE_IN_BTC);
        await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
        const recipientRskAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        
        // Execute peg-out
        await sendTxToBridge(rskTxHelper, MIN_PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);
        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        const senderAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
       
        const recipientRskAddressBalanceFinal = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));

        expect(Number(recipientRskAddressBalanceAfterPegin)).to.be.equal(btcEthUnitConverter.btcToWeis(PEGIN_VALUE_IN_BTC));
        expect(Number(senderAddressBalanceFinal)).to.be.above(MIN_PEGOUT_VALUE_IN_RBTC - TX_FEE_IN_RBTC).and.below(MIN_PEGOUT_VALUE_IN_RBTC);
        expect(Number(recipientRskAddressBalanceFinal)).to.be.above(btcEthUnitConverter.btcToWeis(PEGIN_VALUE_IN_BTC - MIN_PEGOUT_VALUE_IN_RBTC - TX_FEE_IN_RBTC)).and.below(btcEthUnitConverter.btcToWeis(PEGIN_VALUE_IN_BTC - MIN_PEGOUT_VALUE_IN_RBTC));
    });
});

