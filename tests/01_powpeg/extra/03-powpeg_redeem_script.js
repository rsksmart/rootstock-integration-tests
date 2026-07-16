const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { getRskTransactionHelpers } = require('../../../lib/rsk-tx-helper-provider');
const { getBridge } = require('../../../lib/bridge-provider');
const { getFedsPubKeys } = require('../../../lib/rsk-utils');
const CustomError = require('../../../lib/CustomError');
const removePrefix0x = require('../../../lib/utils').removePrefix0x;
const { ERP_PUBKEYS, ERP_CSV_VALUE } = require('../../../lib/constants/federation-constants');

describe('@regression @federation-change Calling getActivePowpegRedeemScript method', function () {
    let rskTxHelper;
    let bridge;

    before(async () => {
        const rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        bridge = await getBridge(rskTxHelper.getClient());
    });

    it('should return the active powpeg redeem script', async () => {
        try {
            const activePowpegRedeemScript = await bridge.methods
                .getActivePowpegRedeemScript()
                .call();
            const activeFederationAddressFromBridge = await bridge.methods
                .getFederationAddress()
                .call();

            // Build the expected redeem script from the active federation public keys
            const activeFederationBtcPublicKeys = await getFedsPubKeys(bridge);
            const expectedRedeemScript = redeemScriptParser
                .getP2shErpRedeemScript(activeFederationBtcPublicKeys, ERP_PUBKEYS, ERP_CSV_VALUE)
                .toString('hex');

            const addressFromRedeemScript = redeemScriptParser.getP2shP2wshAddressFromRedeemScript(
                'REGTEST',
                Buffer.from(removePrefix0x(activePowpegRedeemScript), 'hex')
            );

            expect(removePrefix0x(activePowpegRedeemScript)).to.eq(expectedRedeemScript);
            expect(addressFromRedeemScript).to.eq(activeFederationAddressFromBridge);
        } catch (err) {
            throw new CustomError('getActivePowpegRedeemScript method validation failure', err);
        }
    });
});
