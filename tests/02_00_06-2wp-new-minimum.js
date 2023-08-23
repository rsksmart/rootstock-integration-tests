const { expect } = require('chai');
const btcClientProvider = require('../lib/btc-client-provider');
const _2wpUtilsLegacy = require('../lib/2wp-utils-legacy')
const rsk = require('peglib').rsk;
const keyUtils = require('peglib').keyUtils;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');

const MIN_PEGOUT_VALUE_IN_SATOSHIS = 250000;
const BTC_TX_FEE_IN_SATOSHIS = 100000;

let btcClient;
let rskClient;
let pegUtils;
let minimumPeginValueInSatoshis;

describe('2wp after iris300, using new minimum values', () => {
    before(async () => {
        btcClient = btcClientProvider.getBtcClient();
        rskClient = rsk.getClient(Runners.hosts.federate.host);
        pegUtils = _2wpUtilsLegacy.with(btcClient, rskClient);

        // Get the current peg-in minimum
        minimumPeginValueInSatoshis = await rskClient.rsk.bridge.methods.getMinimumLockTxValue().call();
    });
    
    it('should peg-in when sending minimum value', async () => {
        const AMOUNT_TO_LOCK_IN_BTC = btcClient.nodeClient.satoshisToBtc(minimumPeginValueInSatoshis);

        // Create legacy type address to use as sender
        let senderAddressInformation = await btcClient.generateBtcAddress('legacy');
        let initialSenderBalance = await btcClient.getAddressBalance(senderAddressInformation.address);

        // Get the RSK address where the funds should be locked to
        let rskDerivedAddress = keyUtils.getRskAddress(senderAddressInformation.privateKey);
        let initialDerivedAddressBalance = await rskClient.eth.getBalance(rskDerivedAddress);

        await btcClient.fundAddress(senderAddressInformation.address, AMOUNT_TO_LOCK_IN_BTC + btcClient.getFee());

        // Execute peg-in
        const peginBtcTxHash = await _2wpUtilsLegacy.sendPegin(rskClient, btcClient, senderAddressInformation, AMOUNT_TO_LOCK_IN_BTC);
        await _2wpUtilsLegacy.ensurePeginIsRegistered(rskClient, peginBtcTxHash);
        // Assert
        let finalSenderBalance = await btcClient.getAddressBalance(senderAddressInformation.address);
        let finalDerivedAddressBalance = await rskClient.eth.getBalance(rskDerivedAddress);

        expect(Number(initialSenderBalance)).to.equal(0);
        expect(Number(finalSenderBalance)).to.equal(0);
        expect(Number(initialDerivedAddressBalance)).to.equal(0);
        expect(Number(finalDerivedAddressBalance)).to.equal(rsk.btcToWeis(AMOUNT_TO_LOCK_IN_BTC));
    });

    it('should not peg-in when sending below minimum value', async () => {
        const AMOUNT_TO_LOCK_IN_BTC = btcClient.nodeClient.satoshisToBtc(minimumPeginValueInSatoshis - 1);

        // Create legacy type address to use as sender
        let senderAddressInformation = await btcClient.generateBtcAddress('legacy');
        let initialSenderBalance = await btcClient.getAddressBalance(senderAddressInformation.address);

        // Get the RSK address where the funds should be locked to
        let rskDerivedAddress = keyUtils.getRskAddress(senderAddressInformation.privateKey);
        let initialDerivedAddressBalance = await rskClient.eth.getBalance(rskDerivedAddress);

        await btcClient.fundAddress(senderAddressInformation.address, AMOUNT_TO_LOCK_IN_BTC + btcClient.getFee());

        // Execute peg-in
        await _2wpUtilsLegacy.sendPegin(rskClient, btcClient, senderAddressInformation, AMOUNT_TO_LOCK_IN_BTC);
        const rskClients = Runners.hosts.federates.map(federate => rsk.getClient(federate.host));
        await rskUtilsLegacy.triggerPegoutEvent(rskClients);

        // Assert
        let finalSenderBalance = await btcClient.getAddressBalance(senderAddressInformation.address);
        let finalDerivedAddressBalance = await rskClient.eth.getBalance(rskDerivedAddress);

        expect(Number(initialSenderBalance)).to.equal(0);
        expect(Number(finalSenderBalance)).to.equal(0);
        expect(Number(initialDerivedAddressBalance)).to.equal(0);
        expect(Number(finalDerivedAddressBalance)).to.equal(0);
    });

    it('should peg-out when sending minimum value', async () => {
        // Do a peg-in first to ensure the federation has funds to do the peg-out
        const AMOUNT_TO_LOCK_IN_BTC = 10;
        let senderAddressInformation = await btcClient.generateBtcAddress('legacy');

        await btcClient.fundAddress(senderAddressInformation.address, AMOUNT_TO_LOCK_IN_BTC + btcClient.getFee());

        const peginBtcTxHash = await _2wpUtilsLegacy.sendPegin(rskClient, btcClient, senderAddressInformation, AMOUNT_TO_LOCK_IN_BTC);
        await _2wpUtilsLegacy.ensurePeginIsRegistered(rskClient, peginBtcTxHash);
        let rskDerivedAddress = keyUtils.getRskAddress(senderAddressInformation.privateKey);
        let rskPrivKey = keyUtils.privKeyToRskFormat(senderAddressInformation.privateKey);
        await rskClient.eth.personal.importRawKey(rskPrivKey, "");
        await rskClient.eth.personal.unlockAccount(rskDerivedAddress, '');

        let finalDerivedAddressBalance = await rskClient.eth.getBalance(rskDerivedAddress);
        expect(Number(finalDerivedAddressBalance)).to.equal(rsk.btcToWeis(AMOUNT_TO_LOCK_IN_BTC));

        let txResult = await pegUtils.sendTxToBridge(rskDerivedAddress, rsk.satoshisToWeis(MIN_PEGOUT_VALUE_IN_SATOSHIS));

        let minExpectedValue = MIN_PEGOUT_VALUE_IN_SATOSHIS - BTC_TX_FEE_IN_SATOSHIS;
        let callBackParams = { rskAddress: rskDerivedAddress, value: minExpectedValue };
        await pegUtils.assertEventFound('release_request_received', _2wpUtilsLegacy.releaseRequestReceivedCallback, callBackParams, 1);
        
        const rskClients = Runners.hosts.federates.map(federate => rsk.getClient(federate.host));
        await rskUtilsLegacy.triggerPegoutEvent(rskClients);

        callBackParams = { rskTxHash: txResult.transactionHash, minExpectedValue: minExpectedValue };
        await pegUtils.assertEventFound('release_requested', _2wpUtilsLegacy.releaseRequestedCallback, callBackParams, 10);
          
        let finalSenderBalance = await btcClient.getAddressBalance(senderAddressInformation.address);
        finalDerivedAddressBalance = await rskClient.eth.getBalance(rskDerivedAddress);
        
        let difference = AMOUNT_TO_LOCK_IN_BTC - finalSenderBalance;
        expect(difference).to.be.at.most(BTC_TX_FEE_IN_SATOSHIS);
        // Final rsk address balance should be less than locked value - released value, since a fee is payed when sending the tx to the bridge
        expect(Number(finalDerivedAddressBalance)).to.be.lessThan(rsk.btcToWeis(AMOUNT_TO_LOCK_IN_BTC) - rsk.satoshisToWeis(MIN_PEGOUT_VALUE_IN_SATOSHIS));
    });
});
