const expect = require('chai').expect
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const CustomError = require('../lib/CustomError');
const lbc = require('../lib/liquidity-bridge-contract');
const { REFUNDED_USER_ERROR } = require("../lib/flyover-pegin-response-codes");
const { ERP_PUBKEYS, ERP_CSV_VALUE } = require("../lib/constants")
const { sendTxWithCheck, triggerRelease, getFedsPubKeys } = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { ensure0x, fundAddressAndGetData, wait } = require('../lib/utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { mineForPeginRegistration } = require('../lib/2wp-utils');

describe('Executing registerFastBtcTransaction after fed change - with release', () => {

  let rskTxHelpers;
  let rskTxHelper;
  let btcTxHelper;
  let bridge;

  before(async () => {
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[rskTxHelpers.length - 1];
    btcTxHelper = getBtcClient();
    const latestActiveForkName = await getLatestActiveForkName();
    bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);
  });

  it('should return funds when calling registerFastBtcTransaction method surpassing locking cap after fed change', async () => {
    try {

      const liquidityBridgeContract = await lbc.getLiquidityBridgeContract(Runners.hosts.federates[Runners.hosts.federates.length - 1].host);
      const initialLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
      const userBtcRefundAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
      const userBtcRefundAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(userBtcRefundAddress));
      const liquidityProviderBtcAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
      const liquidityProviderBtcAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(liquidityProviderBtcAddress));
      const preHash = rskTxHelper.getClient().utils.randomHex(32);
      const FEDS_PUBKEYS_LIST = await getFedsPubKeys(bridge);
      
      const AMOUNT_TO_SEND_IN_BTC = 2500;
      
      const derivationHash = await liquidityBridgeContract.methods.getDerivationHash(
        preHash,
        userBtcRefundAddressBytes,
        liquidityProviderBtcAddressBytes
      ).call();

      const amountForFlyoverInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(AMOUNT_TO_SEND_IN_BTC));

      const fundingAmountInBtc = AMOUNT_TO_SEND_IN_BTC + 1;

      const redeemScript = redeemScriptParser.getP2shErpRedeemScript(FEDS_PUBKEYS_LIST, ERP_PUBKEYS, ERP_CSV_VALUE);

      const flyoverRedeemScript = redeemScriptParser.getFlyoverRedeemScript(redeemScript, derivationHash.substring(2));
      const flyoverFedAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', flyoverRedeemScript);
      const data = await fundAddressAndGetData(btcTxHelper, flyoverFedAddress, AMOUNT_TO_SEND_IN_BTC, fundingAmountInBtc);
      
      const cowAddress = await rskTxHelper.newAccountWithSeed('cow');

      await mineForPeginRegistration(rskTxHelper, btcTxHelper);

      const registerFastBridgeBtcTransactionMethod = liquidityBridgeContract.methods.registerFastBridgeBtcTransaction(
        ensure0x(data.rawTx),
        ensure0x(data.pmt),
        data.height,
        userBtcRefundAddressBytes,
        liquidityProviderBtcAddressBytes,
        preHash
      );

      const checkFunction = (result) => {
        const resultValue = Number(result);
        expect(REFUNDED_USER_ERROR).to.be.equals(resultValue)
      };

      await sendTxWithCheck(
        rskTxHelper,
        registerFastBridgeBtcTransactionMethod,
        cowAddress,
        checkFunction
      );

      const currentLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
      expect(currentLbcBalance).to.equal(initialLbcBalance);

      // assert the funds are returned to the corresponding refund address when the result is REFUNDED_USER_ERROR or REFUNDED_LP_ERROR
      await triggerRelease(rskTxHelpers, btcTxHelper);
      await wait(500);

      const finalBalanceInSatoshis = Number(btcEthUnitConverter.btcToSatoshis(await btcTxHelper.getAddressBalance(userBtcRefundAddress)));
      const difference = amountForFlyoverInSatoshis - finalBalanceInSatoshis;
      const FEE_IN_SATOSHIS = Number(btcEthUnitConverter.btcToSatoshis(0.001));

      expect(difference).to.be.at.most(FEE_IN_SATOSHIS * 2);

    } catch(e) {
      throw new CustomError('registerFastBridgeBtcTransaction call failure', e);
    }
  });
});
