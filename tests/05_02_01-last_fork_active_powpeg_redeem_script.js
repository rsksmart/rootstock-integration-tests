const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const { compareFederateKeys } = require('../lib/federation-utils');
const rsk = require('peglib').rsk;
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const CustomError = require('../lib/CustomError');
const removePrefix0x = require("../lib/utils").removePrefix0x;
const { 
  ERP_PUBKEYS, 
  ERP_CSV_VALUE,
  INITIAL_FEDERATION_SIZE,
  KEY_TYPE_BTC, 
  KEY_TYPE_RSK, 
  KEY_TYPE_MST
} = require('../lib/constants');
describe('Calling getActivePowpegRedeemScript method after last fork after fed change', function() {

    before(() => {
      rskClient = rsk.getClient(Runners.hosts.federate.host);
    });
    
    it('should return the active powpeg redeem script', async () => {
      try{
        const activePowpegRedeemScript = await rskClient.rsk.bridge.methods.getActivePowpegRedeemScript().call();
        const activeFederationAddressFromBridge = await rskClient.rsk.bridge.methods.getFederationAddress().call();
        const addressFromRedeemScript = redeemScriptParser.getAddressFromRedeemScript(
          'REGTEST', Buffer.from(removePrefix0x(activePowpegRedeemScript), 'hex')
        );
        
        newFederationPublicKeys = Runners.hosts.federates
        .filter((federate, index) => index >= INITIAL_FEDERATION_SIZE)
        .map((federate) => ({
          [KEY_TYPE_BTC]: bitcoin.keys.publicKeyToCompressed(federate.publicKeys[KEY_TYPE_BTC]),
          [KEY_TYPE_RSK]: bitcoin.keys.publicKeyToCompressed(federate.publicKeys[KEY_TYPE_RSK]),
          [KEY_TYPE_MST]: bitcoin.keys.publicKeyToCompressed(federate.publicKeys[KEY_TYPE_MST])
        }))
        .sort(compareFederateKeys);
        console.log("newFederationPublicKeys", newFederationPublicKeys)
      newFederationBtcPublicKeys = newFederationPublicKeys.map(publicKeys => publicKeys[KEY_TYPE_BTC]);

        const p2shErpFedRedeemScript = redeemScriptParser.getP2shErpRedeemScript(newFederationBtcPublicKeys, ERP_PUBKEYS, ERP_CSV_VALUE);
        const expectedNewFederationAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', p2shErpFedRedeemScript);

        expect(activePowpegRedeemScript).to.eq('0x' + p2shErpFedRedeemScript.toString('hex'));
        expect(addressFromRedeemScript).to.eq(expectedNewFederationAddress).to.eq(activeFederationAddressFromBridge);
      } catch (err) {
        throw new CustomError('getActivePowpegRedeemScript method validation failure', err);
      }
    })
});
