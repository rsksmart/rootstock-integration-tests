const expect = require('chai').expect
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

const { getBtcClient } = require('../lib/btc-client-provider');
const { sendPegin, MINIMUM_PEGIN_VALUE_IN_BTC } = require('../lib/2wp-utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { isUtxoRegisteredInBridge } = require('../lib/2wp-utils');

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;

const fulfillRequirementsToRunAsSingleTestFile = async () => {
    await rskUtils.activateFork(Runners.common.forks.wasabi100);
};

describe('Lock p2sh-p2wpkh address', () => {
    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        btcTxHelper = getBtcClient()

        if(process.env.RUNNING_SINGLE_TEST_FILE) {
            await fulfillRequirementsToRunAsSingleTestFile();
        }
    });

    it('lock should fail when using p2sh-p2wpkh address', async () => {
        const senderAddress = await btcTxHelper.generateBtcAddress('p2sh-segwit')

        const latestActiveForkName = await getLatestActiveForkName();
        const bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
        const federationAddress = await bridge.methods.getFederationAddress().call();

        const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

        await btcTxHelper.fundAddress(senderAddress.address, MINIMUM_PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());

        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddress, MINIMUM_PEGIN_VALUE_IN_BTC);

        const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(Number(federationAddressBalanceAfterPegin)).to.be.equal(Number(federationAddressBalanceInitial + MINIMUM_PEGIN_VALUE_IN_BTC))

        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

        const isPeginUtxoRegistered = await isUtxoRegisteredInBridge(rskTxHelper, btcPeginTxHash);
        expect(isPeginUtxoRegistered).to.be.false;

        const federationAddressBalanceFinal = Number(await btcTxHelper.getAddressBalance(federationAddress));
        expect(Number(federationAddressBalanceFinal)).to.be.equal(Number(federationAddressBalanceInitial + MINIMUM_PEGIN_VALUE_IN_BTC))

        const senderAddressBalanceFinal = await btcTxHelper.getAddressBalance(senderAddress.address);
        expect(Number(senderAddressBalanceFinal)).to.be.equal(0)
    });
})
