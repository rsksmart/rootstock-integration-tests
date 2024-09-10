const expect = require('chai').expect
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { sendPegin, ensurePeginIsRegistered, sendTxToBridge } = require('../lib/2wp-utils');
const { getBridge } = require('../lib/precompiled-abi-forks-util');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const whitelistingAssertions = require('../lib/assertions/whitelisting');

describe('Transfer BTC to RBTC before papyrus200', function() {

  let rskTxHelpers;
  let btcTxHelper;
  let rskTxHelper;

  const PEGIN_VALUE_IN_BTC = 3;
  const PEGOUT_VALUE_IN_RBTC = PEGIN_VALUE_IN_BTC / 3;
  const RSK_TX_FEE_IN_RBTC = 0.001;
  
  before(async () => {
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      btcTxHelper = getBtcClient();
  });


  it('should do a multiple pegouts from the same rsk address after making a pegin', async () => {
    const btcAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
    await whitelistingAssertions.assertAddLimitedLockWhitelistAddress(rskTxHelper, btcAddressInfo.address, Number(btcEthUnitConverter.btcToSatoshis(PEGIN_VALUE_IN_BTC)));
    await rskUtils.mineAndSync(rskTxHelpers);
    
    const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInfo.privateKey, btcTxHelper.btcConfig.network);
    await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
    const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
    expect(unlocked, 'Account was not unlocked').to.be.true;

    const bridge = getBridge(rskTxHelper.getClient());
    const federationAddress = await bridge.methods.getFederationAddress().call();

    const federationAddressBalanceInitial = Number(await btcTxHelper.getAddressBalance(federationAddress));

    await btcTxHelper.fundAddress(btcAddressInfo.address, PEGIN_VALUE_IN_BTC + btcTxHelper.getFee());
    
    const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, btcAddressInfo, PEGIN_VALUE_IN_BTC);
    await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
    const recipientRskAddressBalanceAfterPegin = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    expect(Number(recipientRskAddressBalanceAfterPegin)).to.be.equal(Number(btcEthUnitConverter.btcToWeis(PEGIN_VALUE_IN_BTC)));

    await sendTxToBridge(rskTxHelper, PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

    const federationAddressBalanceAfterFirstPegout = Number(await btcTxHelper.getAddressBalance(federationAddress));
    expect(Number(federationAddressBalanceAfterFirstPegout)).to.be.equal(Number(federationAddressBalanceInitial + PEGIN_VALUE_IN_BTC - PEGOUT_VALUE_IN_RBTC));

    const senderAddressBalanceAfterFirstPegout = Number(await btcTxHelper.getAddressBalance(btcAddressInfo.address));
    expect(Number(senderAddressBalanceAfterFirstPegout)).to.be.above(PEGOUT_VALUE_IN_RBTC - btcTxHelper.getFee()).and.below(PEGOUT_VALUE_IN_RBTC);

    const recipientRskAddressBalanceAfterFirstPegout = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    expect(Number(recipientRskAddressBalanceAfterFirstPegout)).to.be.above(Number(btcEthUnitConverter.btcToWeis(PEGIN_VALUE_IN_BTC - PEGOUT_VALUE_IN_RBTC - RSK_TX_FEE_IN_RBTC))).and.below(Number(btcEthUnitConverter.btcToWeis(PEGIN_VALUE_IN_BTC - PEGOUT_VALUE_IN_RBTC)));
    
    await sendTxToBridge(rskTxHelper, PEGOUT_VALUE_IN_RBTC, recipientRskAddressInfo.address);
    await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

    const senderAddressBalanceAfterSecondPegout = Number(await btcTxHelper.getAddressBalance(btcAddressInfo.address));
    expect(Number(senderAddressBalanceAfterSecondPegout)).to.be.above(senderAddressBalanceAfterFirstPegout + PEGOUT_VALUE_IN_RBTC - btcTxHelper.getFee()).and.below(senderAddressBalanceAfterFirstPegout + PEGOUT_VALUE_IN_RBTC);

    const recipientRskAddressBalanceAfterSecondPegout = Number(await rskTxHelper.getBalance(recipientRskAddressInfo.address));
    expect(Number(recipientRskAddressBalanceAfterSecondPegout)).to.be.above(recipientRskAddressBalanceAfterFirstPegout - Number(btcEthUnitConverter.btcToWeis(PEGOUT_VALUE_IN_RBTC + RSK_TX_FEE_IN_RBTC))).and.below(recipientRskAddressBalanceAfterFirstPegout - Number(btcEthUnitConverter.btcToWeis(PEGOUT_VALUE_IN_RBTC)));
  });
});

