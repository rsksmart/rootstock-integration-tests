const expect = require('chai').expect
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR } = require("../lib/flyover-pegin-response-codes");
const CustomError = require('../lib/CustomError');
const lbc = require('../lib/liquidity-bridge-contract');
const { sendTxWithCheck, getFedsPubKeys } = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { ensure0x } = require('../lib/utils');
const { fundAddressAndGetData } = require('../lib/btc-utils');
const { getBridge } = require('../lib/precompiled-abi-forks-util');
const { mineForPeginRegistration } = require('../lib/2wp-utils');

describe('Executing registerFastBtcTransaction after hop - send funds below minimum', () => {

  let rskTxHelpers;
  let rskTxHelper;
  let btcTxHelper;
  let bridge;

  before(async () => {
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    btcTxHelper = getBtcClient();
    bridge = getBridge(rskTxHelper.getClient());
  });

  it(`should return UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR(${UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR}) when calling registerFastBtcTransaction method sending amount below minimum`, async () => {
    try {

      const liquidityBridgeContract = await lbc.getLiquidityBridgeContract(Runners.hosts.federate.host);
      const initialLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
      const FEDS_PUBKEYS_LIST = await getFedsPubKeys(bridge);
      const userBtcRefundAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
      const userBtcRefundAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(userBtcRefundAddress));
      const liquidityProviderBtcAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
      const liquidityProviderBtcAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(liquidityProviderBtcAddress));
      const preHash = rskTxHelper.getClient().utils.randomHex(32);

      const AMOUNT_TO_SEND_IN_BTC = 0.02;
      
      const derivationHash = await liquidityBridgeContract.methods.getDerivationHash(
        preHash,
        userBtcRefundAddressBytes,
        liquidityProviderBtcAddressBytes
      ).call();

      const fundingAmountInBtc = AMOUNT_TO_SEND_IN_BTC + 1;

      const redeemScript = redeemScriptParser.getPowpegRedeemScript(FEDS_PUBKEYS_LIST);

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
        expect(UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR).to.be.equals(resultValue);
      };

      await sendTxWithCheck(
        rskTxHelper,
        registerFastBridgeBtcTransactionMethod,
        cowAddress,
        checkFunction
      );

      const currentLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
      expect(currentLbcBalance).to.equal(initialLbcBalance);

    } catch(e) {
      throw new CustomError('registerFastBridgeBtcTransaction call failure', e);
    }
  });
});
