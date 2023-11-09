const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

const rsk = require('peglib').rsk;
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const CustomError = require('../lib/CustomError');
const removePrefix0x = require("../lib/utils").removePrefix0x;
const { GENESIS_FEDERATION_ADDRESS, GENESIS_FEDERATION_REDEEM_SCRIPT } = require('../lib/constants');
let rskClient;

describe('Calling getActivePowpegRedeemScript method after last fork before fedchange', function() {

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
        
        expect(activePowpegRedeemScript).to.eq(GENESIS_FEDERATION_REDEEM_SCRIPT);
        expect(addressFromRedeemScript).to.eq(GENESIS_FEDERATION_ADDRESS).to.eq(activeFederationAddressFromBridge);
      } catch (err) {
        throw new CustomError('getActivePowpegRedeemScript method validation failure', err);
      }
    })
});
