const expect = require('chai').expect;
const { ensure0x, fundAddressAndGetData, additionalFederationAddresses, } = require('../lib/utils');
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const lbc = require('../lib/liquidity-bridge-contract');
const { mineAndSync, sendTxWithCheck, getFedsPubKeys, activateFork } = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBridge } = require('../lib/precompiled-abi-forks-util');
const btcEthUnitConverter = require('btc-eth-unit-converter');
const { getBtcClient } = require('../lib/btc-client-provider');
const CustomError = require('../lib/CustomError');

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;
let bridge;

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
  await activateFork(Runners.common.forks.iris300);
};

describe('Calling registerFastBtcTransaction after iris', () => {
  
  before(async () => {
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    btcTxHelper = getBtcClient();
    if(process.env.RUNNING_SINGLE_TEST_FILE) {
      await fulfillRequirementsToRunAsSingleTestFile();
    }
    bridge = getBridge(rskTxHelper.getClient(), Runners.common.forks.iris300.name);
  });
  
  it('should return value transferred when calling registerFastBtcTransaction method', async () => {

    try {

      const liquidityBridgeContract = await lbc.getLiquidityBridgeContract();
      expect(Number(await rskTxHelper.getBalance(liquidityBridgeContract._address))).to.equal(0);

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

      const BTC_BALANCE_TO_TRANSFER_IN_BTC = 20;
      const AMOUNT_FOR_FUNDER_IN_BTC = 30;

      const weisToTransfer = btcEthUnitConverter.btcToWeis(BTC_BALANCE_TO_TRANSFER_IN_BTC);
      const powpegRedeemScript = redeemScriptParser.getPowpegRedeemScript(FEDS_PUBKEYS_LIST);
      const flyoverRedeemScript = redeemScriptParser.getFlyoverRedeemScript(powpegRedeemScript, derivationHash.substring(2));
      const flyoverFedAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', flyoverRedeemScript);
      additionalFederationAddresses.add(flyoverFedAddress);
      const data = await fundAddressAndGetData(btcTxHelper, flyoverFedAddress, BTC_BALANCE_TO_TRANSFER_IN_BTC, AMOUNT_FOR_FUNDER_IN_BTC);
      await btcTxHelper.mine(2);
      await rskTxHelper.updateBridge();
      await mineAndSync(rskTxHelpers);

      const cowAddress = await rskTxHelper.newAccountWithSeed('cow');

      const registerFastBridgeBtcTransactionMethod = liquidityBridgeContract.methods.registerFastBridgeBtcTransaction(               
        ensure0x(data.rawTx),
        ensure0x(data.pmt), 
        data.height,
        userBtcRefundAddressBytes,
        liquidityProviderBtcAddressBytes,
        preHash
      );

      const checkFunction = (result) => {
        expect(Number(result)).to.be.equals(weisToTransfer);
      };

      await sendTxWithCheck(
        rskTxHelper,
        registerFastBridgeBtcTransactionMethod,
        cowAddress,
        checkFunction
      );

      const currentRskBalance = await rskTxHelper.getBalance(liquidityBridgeContract._address);
      expect(Number(currentRskBalance)).to.equal(weisToTransfer);

    } catch (err) {
      throw new CustomError('registerFastBridgeBtcTransaction call failure', err);
    }
  });
});
