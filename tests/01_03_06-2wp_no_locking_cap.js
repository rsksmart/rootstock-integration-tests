const expect = require('chai').expect
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { sendPegin, ensurePeginIsRegistered, sendTxToBridge, MINIMUM_PEGIN_VALUE_IN_BTC } = require('../lib/2wp-utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('btc-eth-unit-converter');
const whitelistingAssertions = require('../lib/assertions/whitelisting');

describe('Transfer BTC to RBTC before papyrus200', function() {

  let rskTxHelpers;
  let btcTxHelper;
  let rskTxHelper;

  const PEGIN_VALUE_IN_BTC = 3 * MINIMUM_PEGIN_VALUE_IN_BTC;
  const PEGOUT_VALUE_IN_RBTC = PEGIN_VALUE_IN_BTC / 3;
  const PEGOUT_VALUE_IN_WEIS = btcEthUnitConverter.btcToWeis(PEGOUT_VALUE_IN_RBTC);
  const RSK_TX_FEE_IN_RBTC = 0.001;
  const FINAL_SENDER_BALANCE_APPROX = 2 * PEGOUT_VALUE_IN_RBTC - 2 * RSK_TX_FEE_IN_RBTC
 
  const fulfillRequirementsToRunAsSingleTestFile = async () => {
    await rskUtils.activateFork(Runners.common.forks.wasabi100);
  };
  
  before(async () => {
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      btcTxHelper = getBtcClient();

      if(process.env.RUNNING_SINGLE_TEST_FILE) {
          await fulfillRequirementsToRunAsSingleTestFile();
      };
  });


  it('should do a multiple pegouts from the same rsk address after making a pegin', async () => {
    const btcAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
    await whitelistingAssertions.assertAddLimitedLockWhitelistAddress(rskTxHelper, btcAddressInfo.address, btcEthUnitConverter.btcToSatoshis(PEGIN_VALUE_IN_BTC));
    await rskUtils.mineAndSync(rskTxHelpers);
    
    const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInfo.privateKey, btcTxHelper.btcConfig.network);
    await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
    const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
    expect(unlocked, 'Account was not unlocked').to.be.true;

    const latestActiveForkName = await getLatestActiveForkName();
    const bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
    const federationAddress = await bridge.methods.getFederationAddress().call();

    const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

    await btcTxHelper.fundAddress(btcAddressInfo.address, PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());
    
    const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, btcAddressInfo, PEGIN_VALUE_IN_BTC);
    await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
    const recipientRskAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    expect(Number(recipientRskAddressBalanceAfterPegin)).to.be.equal(btcEthUnitConverter.btcToWeis(PEGIN_VALUE_IN_BTC));

    await sendTxToBridge(rskTxHelper, PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

    const federationAddressBalanceAfterFirstPegout = Number(await btcTxHelper.getAddressBalance(federationAddress));
    expect(Number(federationAddressBalanceAfterFirstPegout)).to.be.equal(Number(federationAddressBalanceInitial + 2 * MINIMUM_PEGIN_VALUE_IN_BTC));

    const senderAddressBalanceAfterFirstPegout = Number(await btcTxHelper.getAddressBalance(btcAddressInfo.address));
    expect(Number(senderAddressBalanceAfterFirstPegout)).to.be.above(MINIMUM_PEGIN_VALUE_IN_BTC - btcTxHelper.getFee()).and.below(MINIMUM_PEGIN_VALUE_IN_BTC);

    const recipientRskAddressAfterFirstPegout = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    expect(Number(recipientRskAddressAfterFirstPegout)).to.be.above(PEGOUT_VALUE_IN_WEIS - RSK_TX_FEE_IN_RBTC).and.below(2 * PEGOUT_VALUE_IN_WEIS);
    
    await sendTxToBridge(rskTxHelper, PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

    const senderAddressBalanceAfterSecondPegout = Number(await btcTxHelper.getAddressBalance(btcAddressInfo.address));
    expect(Number(senderAddressBalanceAfterSecondPegout)).to.be.above(FINAL_SENDER_BALANCE_APPROX).and.below(2 * PEGOUT_VALUE_IN_RBTC);

    const recipientRskAddressAfterSecondPegout = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    expect(Number(recipientRskAddressAfterSecondPegout)).to.be.below(PEGOUT_VALUE_IN_WEIS);
  });
});

