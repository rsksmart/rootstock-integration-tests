const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const CustomError = require('../lib/CustomError');
const removePrefix0x = require('../lib/utils').removePrefix0x;
const {getRskTransactionHelpers} = require('../lib/rsk-tx-helper-provider');
const {getBridge} = require('../lib/bridge-provider');
const { GENESIS_FEDERATION_ADDRESS, GENESIS_FEDERATION_REDEEM_SCRIPT } = require('../lib/constants/federation-constants');

// TODO: Refactor these tests
// Some tests fail after running all tests with all forks active from scratch.
// More analysis need to be done. Also, these tests use legacy functions. We need to refactor them.
describe.skip('Calling getActivePowpegRedeemScript method after hop', function() {
  let rskTxHelpers;
  let rskTxHelper;
  let bridge;
  before(async () => {
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    bridge = getBridge(rskTxHelper.getClient());
  });

  it('should return the active powpeg redeem script', async () => {
    try {
      const activePowpegRedeemScript = await bridge.methods.getActivePowpegRedeemScript().call();
      const activeFederationAddressFromBridge = await bridge.methods.getFederationAddress().call();
      const addressFromRedeemScript = redeemScriptParser.getAddressFromRedeemScript(
          'REGTEST', Buffer.from(removePrefix0x(activePowpegRedeemScript), 'hex'),
      );

      expect(activePowpegRedeemScript).to.eq(GENESIS_FEDERATION_REDEEM_SCRIPT);
      expect(addressFromRedeemScript).to.eq(GENESIS_FEDERATION_ADDRESS).to.eq(activeFederationAddressFromBridge);
    } catch (err) {
      throw new CustomError('getActivePowpegRedeemScript method validation failure', err);
    }
  });
});
