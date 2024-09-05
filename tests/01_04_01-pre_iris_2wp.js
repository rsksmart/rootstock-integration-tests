const { expect } = require('chai');
const peginVerifier = require('pegin-address-verificator');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { getBtcClient } = require('../lib/btc-client-provider');
const { getDerivedRSKAddressInformation } = require('@rsksmart/btc-rsk-derivation');
const { sendPegin, ensurePeginIsRegistered } = require('../lib/2wp-utils');

const AMOUNT_TO_LOCK_IN_BTC = 2;

let rskTxHelper;
let btcTxHelper;

// Skipped due to 'running with all forks active' changes.
// No need for this test anymore after running tests with all forks active, since pegin and pegout tests are already being covered in other tests.

describe.skip('Lock funds using peg-in protocol version 1 before iris300', () => {
    before(async () => {
        rskTxHelper = getRskTransactionHelper();
        btcTxHelper = getBtcClient()
    });
    
    // TODO: rename this test accordingly.
    it('should lock using p2pkh sender to derived address, ignoring OP_RETURN output', async () => {
        // Create legacy type address to use as sender
        const senderAddressInformation = await btcTxHelper.generateBtcAddress('legacy');
        const initialSenderBalance = await btcTxHelper.getAddressBalance(senderAddressInformation.address);

        // Get the RSK address where the funds should be locked to
        const rskDerivedAddress = getDerivedRSKAddressInformation(senderAddressInformation.privateKey, btcTxHelper.btcConfig.network).address;
        const initialDerivedAddressBalance = await rskTxHelper.getBalance(rskDerivedAddress);

        // Create RSK destination address to use in OP_RETURN output
        const privKey = (await btcTxHelper.generateBtcAddress('legacy')).privateKey;
        const rskDestinationAddress = getDerivedRSKAddressInformation(privKey, btcTxHelper.btcConfig.network).address;
        const initialDestinationAddressBalance = await rskTxHelper.getBalance(rskDestinationAddress);

        // Create peg-in data
        const data = [];

        const peginV1DataString = peginVerifier.createPeginV1TxData(rskDestinationAddress);

        data.push(Buffer.from(peginV1DataString, 'hex'));

        await btcTxHelper.fundAddress(senderAddressInformation.address, AMOUNT_TO_LOCK_IN_BTC + btcTxHelper.getFee());

        // Execute peg-in
        const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderAddressInformation, AMOUNT_TO_LOCK_IN_BTC, data);
        await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);
        // Assert
        const finalSenderBalance = await btcTxHelper.getAddressBalance(senderAddressInformation.address);
        const finalDerivedAddressBalance = await rskTxHelper.getBalance(rskDerivedAddress);
        const finalDestinationAddressBalance = await rskTxHelper.getBalance(rskDestinationAddress);

        expect(Number(initialSenderBalance)).to.equal(0);
        expect(Number(finalSenderBalance)).to.equal(0);
        expect(Number(initialDerivedAddressBalance)).to.equal(0);
        expect(Number(finalDerivedAddressBalance)).to.equal(0);
        expect(Number(initialDestinationAddressBalance)).to.equal(0);
        expect(Number(finalDestinationAddressBalance)).to.equal(Number(btcEthUnitConverter.btcToWeis(AMOUNT_TO_LOCK_IN_BTC)));
    });
});
