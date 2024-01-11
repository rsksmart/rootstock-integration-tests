const expect = require('chai').expect
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { satoshisToBtc, btcToSatoshis, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { sendPegin, ensurePeginIsRegistered } = require('../lib/2wp-utils');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');

const { WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR} = require('../lib/assertions/whitelisting')

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;
let bridge;
let federationAddress;
let MINIMUM_PEGIN_VALUE_IN_BTC;
let MINIMUM_PEGIN_VALUE_IN_SATS;
let WHITELIST_DISABLE_BLOCK_DELAY;
let FEE_IN_SATOSHI;
const DELAY_SET_SUCCSSFULY = 1;

const fulfillRequirementsToRunAsSingleTestFile = async () => {
  await rskUtils.activateFork(Runners.common.forks.papyrus200);
};

describe('Disable whitelisting', function() {

  before(async () => {
    if(process.env.RUNNING_SINGLE_TEST_FILE) {
      await fulfillRequirementsToRunAsSingleTestFile();
    }
    
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    btcTxHelper = getBtcClient();

    const latestActiveForkName = await getLatestActiveForkName();
    bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
    federationAddress = await bridge.methods.getFederationAddress().call();
    MINIMUM_PEGIN_VALUE_IN_SATS = await bridge.methods.getMinimumLockTxValue().call();
    MINIMUM_PEGIN_VALUE_IN_BTC = Number(satoshisToBtc(MINIMUM_PEGIN_VALUE_IN_SATS));
    WHITELIST_DISABLE_BLOCK_DELAY = 20;
    FEE_IN_SATOSHI = btcToSatoshis(btcTxHelper.getFee())
  });

  it('should disable lock whitelist', async () => {
    const btcAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
    const btcAmountToFund = 2 * MINIMUM_PEGIN_VALUE_IN_BTC + 2 * btcTxHelper.getFee();
    await btcTxHelper.fundAddress(btcAddressInfo.address, btcAmountToFund);
    const btcAddressBalanceInitial = Number(btcToSatoshis(await btcTxHelper.getAddressBalance(btcAddressInfo.address)));
    expect(btcAddressBalanceInitial).to.be.equal(Number(btcToSatoshis(btcAmountToFund)));

    const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

    // address is not whitelisted
    await sendPegin(rskTxHelper, btcTxHelper, btcAddressInfo, MINIMUM_PEGIN_VALUE_IN_BTC);
    const btcAddressBalanceAfterFirstPegin = Number(btcToSatoshis(await btcTxHelper.getAddressBalance(btcAddressInfo.address)));
    expect(btcAddressBalanceAfterFirstPegin).to.be.equal(btcAddressBalanceInitial - MINIMUM_PEGIN_VALUE_IN_SATS - FEE_IN_SATOSHI);
    const federationAddressBalanceAfterFirstPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
    expect(federationAddressBalanceAfterFirstPegin).to.be.equal(federationAddressBalanceInitial + MINIMUM_PEGIN_VALUE_IN_BTC)
    
    // wait for the btc to come back so we can use the sendPegin method again
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);
    const btcAddressBalanceAfterFirstTriggerRelease = Number(btcToSatoshis(await btcTxHelper.getAddressBalance(btcAddressInfo.address)));
    expect(btcAddressBalanceInitial - btcAddressBalanceAfterFirstTriggerRelease).to.be.at.most(FEE_IN_SATOSHI * 2)
    const federationAddressBalanceAfterFirstTriggerRelease = Number(await btcTxHelper.getAddressBalance(federationAddress));
    expect(federationAddressBalanceAfterFirstTriggerRelease).to.be.equal(federationAddressBalanceInitial)

    // disable whitelisting after 20 blocks
    const unlocked = await rskUtils.getUnlockedAddress(rskTxHelper, WHITELIST_CHANGE_PK, WHITELIST_CHANGE_ADDR);
    expect(unlocked).to.be.true;
    const disableLockWhitelistMethod = bridge.methods.setLockWhitelistDisableBlockDelay(WHITELIST_DISABLE_BLOCK_DELAY);
    const disableResultCallback = (disableResult) => expect(Number(disableResult)).to.equal(DELAY_SET_SUCCSSFULY);
    await rskUtils.sendTxWithCheck(rskTxHelper, disableLockWhitelistMethod, WHITELIST_CHANGE_ADDR, disableResultCallback);

    await btcTxHelper.mine(WHITELIST_DISABLE_BLOCK_DELAY / 2);
    await rskUtils.waitAndUpdateBridge(rskTxHelper);

    // address is still not able to send btc to bridge after 10 blocks
    await sendPegin(rskTxHelper, btcTxHelper, btcAddressInfo, MINIMUM_PEGIN_VALUE_IN_BTC);
    const btcAddressBalanceAfterSecondPegin = Number(btcToSatoshis(await btcTxHelper.getAddressBalance(btcAddressInfo.address)));
    expect(btcAddressBalanceAfterFirstTriggerRelease - btcAddressBalanceAfterSecondPegin).to.be.at.most(Number(MINIMUM_PEGIN_VALUE_IN_SATS + FEE_IN_SATOSHI * 2))
    const federationAddressBalanceAfterSecondPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
    expect(federationAddressBalanceAfterSecondPegin).to.be.equal(federationAddressBalanceInitial + MINIMUM_PEGIN_VALUE_IN_BTC)
    
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);
    const btcAddressBalanceAfterSecondTriggerRelease = Number(btcToSatoshis(await btcTxHelper.getAddressBalance(btcAddressInfo.address)));
    expect(btcAddressBalanceAfterFirstTriggerRelease - btcAddressBalanceAfterSecondTriggerRelease).to.be.at.most(FEE_IN_SATOSHI * 2)
    const federationAddressBalanceAfterSecondTriggerRelease = Number(await btcTxHelper.getAddressBalance(federationAddress));
    expect(federationAddressBalanceAfterSecondTriggerRelease).to.be.equal(federationAddressBalanceInitial)

    await btcTxHelper.mine(WHITELIST_DISABLE_BLOCK_DELAY / 2);
    await rskUtils.waitAndUpdateBridge(rskTxHelper);

    // after 20 blocks the whitelist period has ended and we can send money to the bridge
    const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, btcAddressInfo, MINIMUM_PEGIN_VALUE_IN_BTC);
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);
    await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);

    const federationAddressBalanceAfterPegin = Number(await btcTxHelper.getAddressBalance(federationAddress));
    expect(Number(federationAddressBalanceAfterPegin)).to.be.equal(Number(federationAddressBalanceInitial + MINIMUM_PEGIN_VALUE_IN_BTC));

    const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInfo.privateKey, btcTxHelper.btcConfig.network);
    const recipientRskAddressBalance = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    expect(recipientRskAddressBalance).to.be.equal(Number(satoshisToWeis(MINIMUM_PEGIN_VALUE_IN_SATS)));
  });
});
