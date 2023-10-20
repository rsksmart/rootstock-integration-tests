const expect = require('chai').expect
const CustomError = require('../lib/CustomError');
const rskUtils = require('../lib/rsk-utils');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { sendTxToBridge } = require('../lib/2wp-utils');
const { ensure0x } = require('../lib/utils');

let btcTxHelper;
let rskTxHelpers;

describe('pegout events improvements - pre fingerroot', () => {

  before(async () => {
    btcTxHelper = getBtcClient();
    rskTxHelpers = getRskTransactionHelpers();
  });
  
  it('release_request_received event generates address as hash160', async () => {
    try {

      const rskTxHelper = rskTxHelpers[rskTxHelpers.length - 1];

      const INITIAL_RSK_BALANCE = 0.01;
      const PEGOUT_AMOUNT_IN_RBTC = 0.005;
      const PEGOUT_AMOUNT_IN_SATOSHIS = Number(btcEthUnitConverter.btcToSatoshis(PEGOUT_AMOUNT_IN_RBTC));

      const btcAddressInformation = await btcTxHelper.generateBtcAddress('legacy');

      const recipientRskAddressInfo = getDerivedRSKAddressInformation(btcAddressInformation.privateKey, btcTxHelper.btcConfig.network);

      await rskTxHelper.importAccount(recipientRskAddressInfo.privateKey);
      const unlocked = await rskTxHelper.unlockAccount(recipientRskAddressInfo.address);
      expect(unlocked, 'Account was not unlocked').to.be.true;

      await rskUtils.sendFromCow(rskTxHelper, recipientRskAddressInfo.address, Number(btcEthUnitConverter.btcToWeis(INITIAL_RSK_BALANCE)));
      
      await sendTxToBridge(rskTxHelper, PEGOUT_AMOUNT_IN_RBTC, recipientRskAddressInfo.address);

      const pegoutRequestReceivedEvent = await rskUtils.findEventInBlock(rskTxHelper, 'release_request_received');

      expect(pegoutRequestReceivedEvent).to.not.be.null;

      const btcDestinationAddress = pegoutRequestReceivedEvent.arguments.btcDestinationAddress;
      
      expect(pegoutRequestReceivedEvent.arguments.sender.toLowerCase()).to.equal(ensure0x(recipientRskAddressInfo.address));
      expect(Number(pegoutRequestReceivedEvent.arguments.amount)).to.equal(PEGOUT_AMOUNT_IN_SATOSHIS);

      expect(ensure0x(btcTxHelper.decodeBase58Address(btcAddressInformation.address, false))).to.equal(btcDestinationAddress);

      // This is to ensure that the pegout is not left behind in the bridge by pushing it all the way through
      await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

    }
    catch (err) {
      throw new CustomError('Transfer RBTC to BTC failure', err);
    }
  }); 

});
