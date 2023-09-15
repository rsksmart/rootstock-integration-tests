const expect = require('chai').expect
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { sendPegin, MINIMUM_PEGIN_VALUE_IN_BTC, ensurePeginIsRegistered } = require('../lib/2wp-utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('btc-eth-unit-converter');


let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;


const fulfillRequirementsToRunAsSingleTestFile = async () => {
    await rskUtils.activateFork(Runners.common.forks.fingerroot500);
};

describe('Lock using p2sh-p2wpkh address', () => {
    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient();

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile();
        }
    });

    it('should do a legacy pegin using p2sh-p2wpkh address', async () => {
        const senderAddressInfo = await btcTxHelper.generateBtcAddress('p2sh-segwit');

        const bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
        const federationAddress = await bridge.methods.getFederationAddress().call();
        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

        const recipientRskAddressInfo = getDerivedRSKAddressInformation(senderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
        await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
        const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
        expect(unlocked, 'Account was not unlocked').to.be.true;

        await btcTxHelper.fundAddress(senderAddressInfo.address, MINIMUM_PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());
        
        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, MINIMUM_PEGIN_VALUE_IN_BTC);
        await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(Number(federationAddressBalanceAfterPegin)).to.be.equal(Number(federationAddressBalanceInitial + MINIMUM_PEGIN_VALUE_IN_BTC));

        const senderAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(Number(senderAddressBalanceAfterPegin)).to.be.equal(0);

        const recipientRskAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(Number(recipientRskAddressBalanceAfterPegin)).to.be.equal(btcEthUnitConverter.btcToWeis(MINIMUM_PEGIN_VALUE_IN_BTC));
    });   
});
