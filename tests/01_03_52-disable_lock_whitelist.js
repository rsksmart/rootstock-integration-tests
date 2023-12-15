const expect = require('chai').expect
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { satoshisToBtc } = require('@rsksmart/btc-eth-unit-converter');
const { sendPegin, ensurePeginIsRegistered } = require('../lib/2wp-utils');

const { WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR} = require('../lib/assertions/whitelisting')

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;
let bridge;
let MINIMUM_PEGIN_VALUE_IN_BTC;
let federationAddress;

const fulfillRequirementsToRunAsSingleTestFile = async () => {
  await rskUtils.activateFork(Runners.common.forks.papyrus200);
};

describe('Disable whitelisting', function() {

  before(async () => {
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    btcTxHelper = getBtcClient();

    const latestActiveForkName = await getLatestActiveForkName();
    bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
    federationAddress = await bridge.methods.getFederationAddress().call();
    const minPeginValueInSatoshis = await bridge.methods.getMinimumLockTxValue().call();
    MINIMUM_PEGIN_VALUE_IN_BTC = Number(satoshisToBtc(minPeginValueInSatoshis));

    if(process.env.RUNNING_SINGLE_TEST_FILE) {
      await fulfillRequirementsToRunAsSingleTestFile();
    }
  });

  it('should disable lock whitelist', async () => {
    const btcAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
    await btcTxHelper.fundAddress(btcAddressInfo.address, 2 * MINIMUM_PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());
    const btcAddressInfoBalanceInitial = Number(await btcTxHelper.getAddressBalance(btcAddressInfo.address));
    expect(btcAddressInfoBalanceInitial).to.be.equal(2 * MINIMUM_PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());

    const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

    // address is not whitelisted
    await sendPegin(rskTxHelper, btcTxHelper, btcAddressInfo, MINIMUM_PEGIN_VALUE_IN_BTC);
    // wait for the btc to come back so we can use the sendPegin method again
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

    // disable whitelisting after 20 blocks
    const unlocked = await rskUtils.getUnlockedAddress(rskTxHelper, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);
    expect(unlocked).to.be.true;
    const disableLockWhitelistMethod = bridge.methods.setLockWhitelistDisableBlockDelay(20);
    const disableResultCallback = (disableResult) => expect(Number(disableResult)).to.equal(1);
    await rskUtils.sendTxWithCheck(rskTxHelper, disableLockWhitelistMethod, WHITELIST_CHANGE_ADDR, disableResultCallback);

    await btcTxHelper.mine(10);
    await rskUtils.waitAndUpdateBridge(rskTxHelper);

    // address is still not able to send btc to bridge after 10 blocks
    await sendPegin(rskTxHelper, btcTxHelper, btcAddressInfo, MINIMUM_PEGIN_VALUE_IN_BTC);
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

    await btcTxHelper.mine(10);
    await rskUtils.waitAndUpdateBridge(rskTxHelper);

    // after 20 blocks the whitelist period has ended and we can send money to the bridge
    const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, btcAddressInfo, MINIMUM_PEGIN_VALUE_IN_BTC);
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);
    await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);

    const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
    expect(Number(federationAddressBalanceAfterPegin)).to.be.equal(Number(federationAddressBalanceInitial + MINIMUM_PEGIN_VALUE_IN_BTC));
  });
});
