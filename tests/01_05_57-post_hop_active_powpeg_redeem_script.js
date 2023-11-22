const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const CustomError = require('../lib/CustomError');
const removePrefix0x = require('../lib/utils').removePrefix0x;
const {getRskTransactionHelpers} = require('../lib/rsk-tx-helper-provider');
const {getBridge, getLatestActiveForkName} = require('../lib/precompiled-abi-forks-util');
const {GENESIS_FEDERATION_ADDRESS, GENESIS_FEDERATION_REDEEM_SCRIPT} = require('../lib/constants');
const {activateFork} = require('../lib/rsk-utils');
/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async () => {
  await activateFork(Runners.common.forks.hop400);
};
describe('Calling getActivePowpegRedeemScript method after hop', function() {
  let rskTxHelpers;
  let rskTxHelper;
  let bridge;
  before(async () => {
    if (process.env.RUNNING_SINGLE_TEST_FILE) {
      await fulfillRequirementsToRunAsSingleTestFile();
    }
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());
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
