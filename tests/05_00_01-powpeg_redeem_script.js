const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { compareFederateKeys } = require('../lib/federation-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const CustomError = require('../lib/CustomError');
const { removePrefix0x } = require('../lib/utils');
const { publicKeyToCompressed } = require('../lib/btc-utils');
const { getBridge } = require('../lib/bridge-provider');

// in order to run this as a single test file, it requires a federation change so follow the following command
// npm run run-single-test-file 04_00_02-fedchange.js,05_02_01-last_fork_active_powpeg_redeem_script.js

const {
  ERP_PUBKEYS,
  ERP_CSV_VALUE,
  KEY_TYPE_BTC,
  KEY_TYPE_RSK,
  KEY_TYPE_MST,
} = require('../lib/constants/federation-constants');
const INITIAL_FEDERATION_SIZE = 3;

let rskTxHelpers;
let rskTxHelper;
let bridge;

describe('Calling getActivePowpegRedeemScript method after last fork after fed change', function() {
  before(async () => {
    rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    bridge = getBridge(rskTxHelper.getClient());
  });

  it('should return the active powpeg redeem script', async () => {
    try {
      const activePowpegRedeemScript = await bridge.methods
          .getActivePowpegRedeemScript()
          .call();
      const activeFederationAddressFromBridge = await bridge.methods.getFederationAddress().call();
      const addressFromRedeemScript = redeemScriptParser.getAddressFromRedeemScript(
          'REGTEST',
          Buffer.from(removePrefix0x(activePowpegRedeemScript), 'hex'),
      );
      const newFederationPublicKeys = Runners.hosts.federates
          .filter((federate, index) => index >= INITIAL_FEDERATION_SIZE)
          .map((federate) => ({
            [KEY_TYPE_BTC]: publicKeyToCompressed(
              federate.publicKeys[KEY_TYPE_BTC],
          ),
          [KEY_TYPE_RSK]: publicKeyToCompressed(
              federate.publicKeys[KEY_TYPE_RSK],
          ),
          [KEY_TYPE_MST]: publicKeyToCompressed(
              federate.publicKeys[KEY_TYPE_MST],
          ),
          }))
          .sort(compareFederateKeys);
      const newFederationBtcPublicKeys = newFederationPublicKeys.map(
          (publicKeys) => publicKeys[KEY_TYPE_BTC],
      );
      const p2shErpFedRedeemScript = redeemScriptParser.getP2shErpRedeemScript(
          newFederationBtcPublicKeys,
          ERP_PUBKEYS,
          ERP_CSV_VALUE,
      );
      const expectedNewFederationAddress =
        redeemScriptParser.getAddressFromRedeemScript(
            'REGTEST',
            p2shErpFedRedeemScript,
        );

      expect(removePrefix0x(activePowpegRedeemScript)).to.eq(p2shErpFedRedeemScript.toString('hex'));

      
      expect(addressFromRedeemScript)
          .to.eq(expectedNewFederationAddress);
      expect(addressFromRedeemScript)    
          .to.eq(activeFederationAddressFromBridge);
    } catch (err) {
      throw new CustomError(
          'getActivePowpegRedeemScript method validation failure',
          err,
      );
    }
  });
});
