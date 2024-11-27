const expect = require('chai').expect
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { UNPROCESSABLE_TX_ALREADY_PROCESSED_ERROR, REFUNDED_USER_ERROR } = require("../lib/flyover-pegin-response-codes");
const CustomError = require('../lib/CustomError');
const lbc = require('../lib/liquidity-bridge-contract');
const { sendTxWithCheck, getFedsPubKeys } = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { ensure0x } = require('../lib/utils');
const { fundAddressAndGetData } = require('../lib/btc-utils');
const { getBridge } = require('../lib/bridge-provider');
const { mineForPeginRegistration } = require('../lib/2wp-utils');

describe('Executing registerFastBtcTransaction post hop - surpassing locking cap sending same tx without witness twice', () => {

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

  it(`The first tx should fail due to surpassing the locking cap, and the second tx should fail due to hash already been used`, async () => {
    try {

      const liquidityBridgeContract = await lbc.getLiquidityBridgeContract(Runners.hosts.federate.host);
      const initialLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
      const FEDS_PUBKEYS_LIST = await getFedsPubKeys(bridge);
      const userBtcRefundAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
      const userBtcRefundAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(userBtcRefundAddress));
      const liquidityProviderBtcAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
      const liquidityProviderBtcAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(liquidityProviderBtcAddress));
      const preHash = rskTxHelper.getClient().utils.randomHex(32);

      const AMOUNT_TO_SEND_IN_BTC = 2500;

      const derivationHash = await liquidityBridgeContract.methods.getDerivationHash(
        preHash,
        userBtcRefundAddressBytes,
        liquidityProviderBtcAddressBytes
      ).call();

      const fundingAmountInBtc = AMOUNT_TO_SEND_IN_BTC + 1;
      const powpegRedeemScript = redeemScriptParser.getPowpegRedeemScript(FEDS_PUBKEYS_LIST);
      const flyoverRedeemScript = redeemScriptParser.getFlyoverRedeemScript(powpegRedeemScript, derivationHash.substring(2));
      const flyoverFedAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', flyoverRedeemScript);

      const data = await fundAddressAndGetData(btcTxHelper, flyoverFedAddress, AMOUNT_TO_SEND_IN_BTC, fundingAmountInBtc, 'legacy');
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

      const checkFunction = result => {
        const resultValueFromFirstTx = Number(result);
        expect(REFUNDED_USER_ERROR).to.be.equals(resultValueFromFirstTx)
      };

      await sendTxWithCheck(
        rskTxHelper,
        registerFastBridgeBtcTransactionMethod,
        cowAddress,
        checkFunction,
      );

      const currentLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));

      expect(currentLbcBalance).to.equal(initialLbcBalance);

      const registerFastBridgeBtcTransactionMethod2 = liquidityBridgeContract.methods.registerFastBridgeBtcTransaction(
        ensure0x(data.rawTx),
        ensure0x(data.pmt),
        data.height,
        userBtcRefundAddressBytes,
        liquidityProviderBtcAddressBytes,
        preHash
      );

      const checkFunction2 = result => {
        const resultValueFromSecondTx = Number(result);
        expect(UNPROCESSABLE_TX_ALREADY_PROCESSED_ERROR).to.be.equals(resultValueFromSecondTx)
      };

      await sendTxWithCheck(
        rskTxHelper,
        registerFastBridgeBtcTransactionMethod2,
        cowAddress,
        checkFunction2,
      );

      const finalLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));

      expect(finalLbcBalance).to.equal(initialLbcBalance);

    } catch (err) {
      throw new CustomError('registerFastBtcTransaction call failure', err);
    }
  });
});
