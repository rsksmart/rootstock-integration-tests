const expect = require('chai').expect
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { sendPegin, ensurePeginIsRegistered, disableWhitelisting } = require('../lib/2wp-utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { getBtcClient } = require('../lib/btc-client-provider');

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;

const fulfillRequirementsToRunAsSingleTestFile = async (rskTxHelper, btcTxHelper) => {
    const latestForkName = rskUtils.getLatestForkName();
    await rskUtils.activateFork(latestForkName);
    await disableWhitelisting(rskTxHelper, btcTxHelper);
};

describe('Lock using p2sh-p2wpkh address', () => {
    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient();

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile(rskTxHelper, btcTxHelper);
        }
    });

    it('should do a legacy pegin using p2sh-p2wpkh address', async () => {
        const latestActiveForkName = await getLatestActiveForkName();
        const bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);

        const minimumPeginValueInSatoshis = Number(await bridge.methods.getMinimumLockTxValue().call());
        const minimumPeginValueInBtc = Number(btcEthUnitConverter.satoshisToBtc(minimumPeginValueInSatoshis));

        const federationAddress = await bridge.methods.getFederationAddress().call();
        const federationAddressBalanceInBtcInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const federationAddressBalanceInSatoshisInitial = Number(btcEthUnitConverter.btcToSatoshis(federationAddressBalanceInBtcInitial));

        const senderAddressInfo = await btcTxHelper.generateBtcAddress('p2sh-segwit');
        const recipientRskAddressInfo = getDerivedRSKAddressInformation(senderAddressInfo.privateKey, btcTxHelper.btcConfig.network);
        await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
        const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
        expect(unlocked, 'Account was not unlocked').to.be.true;

        await btcTxHelper.fundAddress(senderAddressInfo.address, minimumPeginValueInBtc + btcTxHelper.getFee());
        
        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInfo, minimumPeginValueInBtc);
        await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

        const federationAddressBalanceInBtcAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        const federationAddressBalanceInSatoshisAfterPegin = Number(btcEthUnitConverter.btcToSatoshis(federationAddressBalanceInBtcAfterPegin));
        expect(federationAddressBalanceInSatoshisAfterPegin).to.be.equal(federationAddressBalanceInSatoshisInitial + minimumPeginValueInSatoshis);

        const senderAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(senderAddressInfo.address));
        expect(senderAddressBalanceAfterPegin).to.be.equal(0);

        const recipientRskAddressBalanceInWeisAfterPegin = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
        expect(recipientRskAddressBalanceInWeisAfterPegin).to.be.equal(Number(btcEthUnitConverter.btcToWeis(minimumPeginValueInBtc)));
    });   
});
