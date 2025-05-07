const expect = require('chai').expect;
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { ensure0x, additionalFederationAddresses, } = require('../lib/utils');
const { fundAddressAndGetData } = require('../lib/btc-utils');
const lbc = require('../lib/liquidity-bridge-contract');
const { sendTxWithCheck, getFedsPubKeys } = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBridge } = require('../lib/bridge-provider');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { getBtcClient } = require('../lib/btc-client-provider');
const CustomError = require('../lib/CustomError');
const { mineForPeginRegistration } = require('../lib/2wp-utils');

let rskTxHelpers;
let rskTxHelper;
let btcTxHelper;
let bridge;

// TODO: Fails with 'Internal AssertionError: expected -304 to equal 20000000000000000000' error. Pending to analyze.
describe.skip('Calling registerFastBridgeBtcTransaction after iris', () => {
  
  before(async () => {
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    btcTxHelper = getBtcClient();
    bridge = await getBridge(rskTxHelper.getClient(), Runners.common.forks.iris300.name);
  });
  
  it('should return value transferred when calling registerFastBridgeBtcTransaction method', async () => {

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

      const weisToTransfer = Number(btcEthUnitConverter.btcToWeis(BTC_BALANCE_TO_TRANSFER_IN_BTC));
      const powpegRedeemScript = redeemScriptParser.getPowpegRedeemScript(FEDS_PUBKEYS_LIST);
      const flyoverRedeemScript = redeemScriptParser.getFlyoverRedeemScript(powpegRedeemScript, derivationHash.substring(2));
      const flyoverFedAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', flyoverRedeemScript);
      additionalFederationAddresses.add(flyoverFedAddress);
      const data = await fundAddressAndGetData(btcTxHelper, flyoverFedAddress, BTC_BALANCE_TO_TRANSFER_IN_BTC, AMOUNT_FOR_FUNDER_IN_BTC);
      
      await mineForPeginRegistration(rskTxHelper, btcTxHelper);

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
