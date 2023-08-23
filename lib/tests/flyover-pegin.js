const expect = require('chai').expect
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const CustomError = require('../CustomError');
const lbc = require('../liquidity-bridge-contract');
const {REFUNDED_USER_ERROR, REFUNDED_LP_ERROR} = require("../flyover-pegin-response-codes");
const {ERP_PUBKEYS, ERP_CSV_VALUE} = require("../constants")
const { sendTxWithCheck, mineAndSync, triggerRelease, getFedsPubKeys } = require('../rsk-utils');
const { getRskTransactionHelpers, getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getBtcClient } = require('../btc-client-provider');
const btcEthUnitConverter = require('btc-eth-unit-converter');
const { ensure0x, fundAddressAndGetData, wait } = require('../utils');
const { getBridge, getLatestActiveForkName } = require('../precompiled-abi-forks-util');

const execute = (
  description,
  testCaseDescription,
  getRskHost,
  alreadyChangedFed,
  expectedResult,
  amountToSendInBtc,
  fundsShouldBeTransferred
) => {
  describe(description, () => {

    let rskTxHelpers;
    let rskTxHelper;
    let btcTxHelper;
    let bridge;

    before(async () => {
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = getRskTransactionHelper(getRskHost());
      btcTxHelper = getBtcClient();
      bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
    });

    it(testCaseDescription, async () => {
      try {

        const liquidityBridgeContract = await lbc.getLiquidityBridgeContract(getRskHost());
        const initialLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
        const FEDS_PUBKEYS_LIST = await getFedsPubKeys(bridge);
        const userBtcRefundAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
        const userBtcRefundAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(userBtcRefundAddress));
        const liquidityProviderBtcAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
        const liquidityProviderBtcAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(liquidityProviderBtcAddress));
        const preHash = rskTxHelper.getClient().utils.randomHex(32);
        
        const derivationHash = await liquidityBridgeContract.methods.getDerivationHash(
          preHash,
          userBtcRefundAddressBytes,
          liquidityProviderBtcAddressBytes
        ).call();

        const amountForFlyoverInSatoshis = btcEthUnitConverter.btcToSatoshis(amountToSendInBtc);
        
        let expectedResultSatoshis;
        let expectedResultInWeis;

        if (fundsShouldBeTransferred) {
          expectedResultSatoshis = btcEthUnitConverter.btcToSatoshis(expectedResult);
          expectedResultInWeis = btcEthUnitConverter.satoshisToWeis(expectedResultSatoshis);
        }

        const fundingAmountInBtc = amountToSendInBtc + 1;
        let redeemScript;

        if (alreadyChangedFed) {
          redeemScript = redeemScriptParser.getP2shErpRedeemScript(FEDS_PUBKEYS_LIST, ERP_PUBKEYS, ERP_CSV_VALUE);
        } else {
          redeemScript = redeemScriptParser.getPowpegRedeemScript(FEDS_PUBKEYS_LIST);
        }

        const flyoverRedeemScript = redeemScriptParser.getFlyoverRedeemScript(redeemScript, derivationHash.substring(2));
        const flyoverFedAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', flyoverRedeemScript);
        const data = await fundAddressAndGetData(btcTxHelper, flyoverFedAddress, amountToSendInBtc, fundingAmountInBtc);
        
        const cowAddress = await rskTxHelper.newAccountWithSeed('cow');

        await btcTxHelper.mine(3);
        await rskTxHelper.updateBridge();
        await mineAndSync(rskTxHelpers);

        const registerFastBridgeBtcTransactionMethod = liquidityBridgeContract.methods.registerFastBridgeBtcTransaction(
          ensure0x(data.rawTx),
          ensure0x(data.pmt),
          data.height,
          userBtcRefundAddressBytes,
          liquidityProviderBtcAddressBytes,
          preHash
        );

        let resultValue;

        const checkFunction = (result) => {
          resultValue = Number(result);
          if (fundsShouldBeTransferred) {
            expect(expectedResultInWeis).to.be.equals(resultValue)
          } else {
            expect(expectedResult).to.be.equals(resultValue)
          }
        };

        await sendTxWithCheck(
          rskTxHelper,
          registerFastBridgeBtcTransactionMethod,
          cowAddress,
          checkFunction
        );

        // if the transaction went OK the following assertion should be met
        if (fundsShouldBeTransferred) {
          const currentLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
          
          expect(currentLbcBalance).to.equal(initialLbcBalance + resultValue);
        } else {
          const currentLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
          expect(currentLbcBalance).to.equal(initialLbcBalance);

          // assert the funds are returned to the corresponding refund address when the result is REFUNDED_USER_ERROR or REFUNDED_LP_ERROR
          if (resultValue == REFUNDED_USER_ERROR || resultValue == REFUNDED_LP_ERROR) {

            await triggerRelease(rskTxHelpers, btcTxHelper);
            await wait(500);

            const refundAddress = resultValue == REFUNDED_USER_ERROR ? userBtcRefundAddress : liquidityProviderBtcAddress;
            const finalBalanceInSatoshis = btcEthUnitConverter.btcToSatoshis(await btcTxHelper.getAddressBalance(refundAddress));
            const difference = amountForFlyoverInSatoshis - finalBalanceInSatoshis;
            const FEE_IN_SATOSHIS = btcEthUnitConverter.btcToSatoshis(0.001);

            expect(difference).to.be.at.most(FEE_IN_SATOSHIS * 2);

          }
        }

      } catch(e) {
        throw new CustomError('registerFastBridgeBtcTransaction call failure', e);
      }
    });
  });
};

const executeSameTxTwice = (
  description,
  testCaseDescription,
  getRskHost,
  withWitness,
  expectedFirstTxResult,
  expectedSecondTxResult,
  amountToSendInBtc
) => {
  describe(description, () => {

    let rskTxHelpers;
    let rskTxHelper;
    let btcTxHelper;
    let bridge;

    before(async () => {
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelper = getRskTransactionHelper(getRskHost());
      btcTxHelper = getBtcClient();
      bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
    });

    it(testCaseDescription, async () => {
      try {
        const firstTxShouldExecuteSuccessfully = expectedFirstTxResult >= 0;
        const secondTxShouldExecuteSuccessfully = expectedSecondTxResult >= 0;

        const liquidityBridgeContract = await lbc.getLiquidityBridgeContract(getRskHost());
        const initialLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
        const FEDS_PUBKEYS_LIST = await getFedsPubKeys(bridge);
        const userBtcRefundAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
        const userBtcRefundAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(userBtcRefundAddress));
        const liquidityProviderBtcAddress = (await btcTxHelper.generateBtcAddress('legacy')).address;
        const liquidityProviderBtcAddressBytes = ensure0x(btcTxHelper.decodeBase58Address(liquidityProviderBtcAddress));
        const preHash = rskTxHelper.getClient().utils.randomHex(32);
        
        const derivationHash = await liquidityBridgeContract.methods.getDerivationHash(
          preHash,
          userBtcRefundAddressBytes,
          liquidityProviderBtcAddressBytes
        ).call();

        const fundingAmountInBtc = amountToSendInBtc + 1;
        const powpegRedeemScript = redeemScriptParser.getPowpegRedeemScript(FEDS_PUBKEYS_LIST);
        const flyoverRedeemScript = redeemScriptParser.getFlyoverRedeemScript(powpegRedeemScript, derivationHash.substring(2));
        const flyoverFedAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', flyoverRedeemScript);

        const btcTypeOfAddress = withWitness ? 'p2sh-segwit' : 'legacy';
        const data = await fundAddressAndGetData(btcTxHelper, flyoverFedAddress, amountToSendInBtc, fundingAmountInBtc, btcTypeOfAddress);
        const cowAddress = await rskTxHelper.newAccountWithSeed('cow');

        await btcTxHelper.mine(3);
        await rskTxHelper.updateBridge();
        await mineAndSync(rskTxHelpers);

        if (withWitness){
          const coinbaseParams = data.coinbaseParams;
          
          const registerBtcCoinbaseTransactionMethod = bridge.methods
            .registerBtcCoinbaseTransaction(
              ensure0x(coinbaseParams.coinbaseTxWithoutWitness.toHex()),
              ensure0x(coinbaseParams.blockHash),
              ensure0x(coinbaseParams.pmt.hex),
              ensure0x(coinbaseParams.witnessMerkleRoot.toString('hex')),
              ensure0x(coinbaseParams.witnessReservedValue)
            );

          await sendTxWithCheck(
            rskTxHelper,
            registerBtcCoinbaseTransactionMethod,
            cowAddress,
            (null)
          );
        }

        const registerFastBridgeBtcTransactionMethod = liquidityBridgeContract.methods.registerFastBridgeBtcTransaction(
          ensure0x(data.rawTx),
          ensure0x(data.pmt),
          data.height,
          userBtcRefundAddressBytes,
          liquidityProviderBtcAddressBytes,
          preHash
        );

        let resultValueFromFirstTx;

        const checkFunction = (result) => {
          resultValueFromFirstTx = Number(result);
          if (firstTxShouldExecuteSuccessfully) {
            const expectedResultSatoshis = btcEthUnitConverter.btcToSatoshis(expectedFirstTxResult);
            const expectedResultInWeis = btcEthUnitConverter.satoshisToWeis(expectedResultSatoshis);
            expect(expectedResultInWeis).to.be.equals(resultValueFromFirstTx)
          } else {
            expect(expectedFirstTxResult).to.be.equals(resultValueFromFirstTx)
          }
        };

        await sendTxWithCheck(
          rskTxHelper,
          registerFastBridgeBtcTransactionMethod,
          cowAddress,
          checkFunction,
        );

        let currentLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
        const midBalance = firstTxShouldExecuteSuccessfully ? initialLbcBalance + resultValueFromFirstTx : initialLbcBalance;
        
        expect(currentLbcBalance).to.equal(midBalance);

        const registerFastBridgeBtcTransactionMethod2 = liquidityBridgeContract.methods.registerFastBridgeBtcTransaction(
          ensure0x(data.rawTx),
          ensure0x(data.pmt),
          data.height,
          userBtcRefundAddressBytes,
          liquidityProviderBtcAddressBytes,
          preHash
        );

        let resultValueFromSecondTx;

        const checkFunction2 = (result) => {
          resultValueFromSecondTx = Number(result);
          if (secondTxShouldExecuteSuccessfully) {
            const expectedResultSatoshis = btcEthUnitConverter.btcToSatoshis(expectedSecondTxResult);
            const expectedResultInWeis = btcEthUnitConverter.satoshisToWeis(expectedResultSatoshis);
            expect(expectedResultInWeis).to.be.equals(resultValueFromSecondTx)
          } else {
            expect(expectedSecondTxResult).to.be.equals(resultValueFromSecondTx)
          }
        };

        await sendTxWithCheck(
          rskTxHelper,
          registerFastBridgeBtcTransactionMethod2,
          cowAddress,
          checkFunction2,
        );

        currentLbcBalance = Number(await rskTxHelper.getBalance(liquidityBridgeContract._address));
        const finalBalance = secondTxShouldExecuteSuccessfully ? midBalance + resultValueFromSecondTx: midBalance;
        expect(currentLbcBalance).to.equal(finalBalance);

      } catch (err) {
        throw new CustomError('registerFastBtcTransaction call failure', err);
      }
    });
  });
};

module.exports = {
  execute,
  executeSameTxTwice
};
