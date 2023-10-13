const expect = require('chai').expect;
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const {UNPROCESSABLE_TX_ALREADY_PROCESSED_ERROR} = require("../lib/flyover-pegin-response-codes");
const CustomError = require('../lib/CustomError');
const lbc = require('../lib/liquidity-bridge-contract');
const { sendTxWithCheck, getFedsPubKeys, activateFork } = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { ensure0x, fundAddressAndGetData } = require('../lib/utils');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { mineForPeginRegistration } = require('../lib/2wp-utils');

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
  await activateFork(Runners.common.forks.iris300);
};

describe('Executing registerFastBtcTransaction post hop - sending same tx without witness twice', () => {

  let rskTxHelpers;
  let rskTxHelper;
  let btcTxHelper;
  let bridge;

  before(async () => {
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    btcTxHelper = getBtcClient();

    if(process.env.RUNNING_SINGLE_TEST_FILE) {
      await fulfillRequirementsToRunAsSingleTestFile();
    }
    const latestActiveForkName = await getLatestActiveForkName();
    bridge = getBridge(rskTxHelper.getClient(), latestActiveForkName);

  });

  it(`should execute first tx successfully and fail executing second tx due to hash already used when calling registerFastBtcTransaction sending same tx twice`, async () => {
    try {

      const liquidityBridgeContract = await lbc.getLiquidityBridgeContract(Runners.hosts.federate.host);
      const initialLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
      const FEDS_PUBKEYS_LIST = await getFedsPubKeys(bridge);
      const userBtcRefundAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
      const userBtcRefundAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(userBtcRefundAddress));
      const liquidityProviderBtcAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
      const liquidityProviderBtcAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(liquidityProviderBtcAddress));
      const preHash = rskTxHelper.getClient().utils.randomHex(32);

      const EXPECTED_AMOUNT_IN_BTC = 0.04;
      
      const derivationHash = await liquidityBridgeContract.methods.getDerivationHash(
        preHash,
        userBtcRefundAddressBytes,
        liquidityProviderBtcAddressBytes
      ).call();

      const fundingAmountInBtc = EXPECTED_AMOUNT_IN_BTC + 1;
      const powpegRedeemScript = redeemScriptParser.getPowpegRedeemScript(FEDS_PUBKEYS_LIST);
      const flyoverRedeemScript = redeemScriptParser.getFlyoverRedeemScript(powpegRedeemScript, derivationHash.substring(2));
      const flyoverFedAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', flyoverRedeemScript);

      const data = await fundAddressAndGetData(btcTxHelper, flyoverFedAddress, EXPECTED_AMOUNT_IN_BTC, fundingAmountInBtc, 'legacy');
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

      let resultValueFromFirstTx;

      const checkFunction = result => {
        resultValueFromFirstTx = Number(result);
        const expectedResultSatoshis = Number(btcEthUnitConverter.btcToSatoshis(EXPECTED_AMOUNT_IN_BTC));
        const expectedResultInWeis = Number(btcEthUnitConverter.satoshisToWeis(expectedResultSatoshis));
        expect(expectedResultInWeis).to.be.equals(resultValueFromFirstTx);
      };

      await sendTxWithCheck(
        rskTxHelper,
        registerFastBridgeBtcTransactionMethod,
        cowAddress,
        checkFunction,
      );

      const currentLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
      const finalBalance = initialLbcBalance + resultValueFromFirstTx;
      
      expect(currentLbcBalance).to.equal(finalBalance);

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

      expect(finalLbcBalance).to.equal(finalBalance);

    } catch (err) {
      throw new CustomError('registerFastBtcTransaction call failure', err);
    }

  });
});
