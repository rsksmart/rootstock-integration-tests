const expect = require('chai').expect
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('btc-eth-unit-converter');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { sendPegin, ensurePeginIsRegistered, disableWhitelisting } = require('../lib/2wp-utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { getBtcClient } = require('../lib/btc-client-provider');

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;

const fulfillRequirementsToRunAsSingleTestFile = async (rskTxHelper) => {
    const latestForkName = rskUtils.getLatestForkName()
    console.log(`latestForkName: ${JSON.stringify(latestForkName)}`)
    await rskUtils.activateFork(latestForkName);
    disableWhitelisting(rskTxHelper)
};

describe('Lock using p2sh-p2wpkh address', () => {
    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient();

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile(rskTxHelper);
            // const latestActiveForkName = await getLatestActiveForkName();
            // console.log(`latestActiveForkName: ${latestActiveForkName}`)
            // bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
            
            // const addr = await rskTxHelper.importAccount(WHITELIST_CHANGE_PK)
            // console.log(`addr: ${addr}`)
            // expect(addr.slice(2)).to.equal(WHITELIST_CHANGE_ADDR);
            // await rskTxHelper.unlockAccount(addr);

            // await rskUtils.sendTxWithCheck(
            //     rskTxHelper,
            //     bridge.methods.setLockWhitelistDisableBlockDelay(1),
            //     WHITELIST_CHANGE_ADDR),
            //     (disableResult) => expect(Number(disableResult)).to.equal(1)();

            // rskTxHelper.mine(1);
        }
    });

    it('should do a legacy pegin using p2sh-p2wpkh address', async () => {
        const latestActiveForkName = await getLatestActiveForkName();
        console.log(`latestActiveForkName: ${latestActiveForkName}`)
        const bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);

        const minimumPeginValueInSatoshis = await bridge.methods.getMinimumLockTxValue().call();
        const minimumPeginValueInBtc = btcEthUnitConverter.satoshisToBtc(minimumPeginValueInSatoshis);

        const federationAddress = await bridge.methods.getFederationAddress().call();
        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));
        console.log(`federationAddressBalanceInitial: ${federationAddressBalanceInitial}`)

        const senderAddressInfo = await btcTxHelper.generateBtcAddress('p2sh-segwit');
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(senderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
        await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
        const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
        expect(unlocked, 'Account was not unlocked').to.be.true;

        await btcTxHelper.fundAddress(senderAddressInfo.address, minimumPeginValueInBtc + btcTxHelper.getFee());
        
        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, minimumPeginValueInBtc);
        await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        console.log(`federationAddressBalanceAfterPegin: ${federationAddressBalanceAfterPegin}`)
        expect(federationAddressBalanceAfterPegin).to.be.equal(Number(federationAddressBalanceInitial + minimumPeginValueInBtc));

        const senderAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceAfterPegin).to.be.equal(0);

        const recipientRskAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(recipientRskAddressBalanceAfterPegin).to.be.equal(btcEthUnitConverter.btcToWeis(minimumPeginValueInBtc));
    });   
});
