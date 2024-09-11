const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBridge, getLatestActiveForkName } = require('../lib/precompiled-abi-forks-util');
const { btcToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { removePrefix0x, ensure0x } = require('../lib/utils');
const bridgeTxParser = require('bridge-transaction-parser-fingerroot500');
const { expect } = require('chai');

const { 
    KEY_TYPE_BTC, 
    KEY_TYPE_RSK, 
    KEY_TYPE_MST,
    REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS,
} = require('../lib/constants');

// Generated with seed newFed1
const newFederator1PublicKey = '0x02f80abfd3dac069887f974ac033cb62991a0ed55b9880faf8b8cbd713b75d649e';
// Generated with seed newFed2
const newFederator2PublicKey = '0x03488898918c76758e52842c700060adbbbd0a38aa836838fd7215147b924ef7dc';

const expectedPendingFederationHash = '0x6f45ac8763317802a9a9c540b58af03e577bb4af14209f8a690d501e21c68ace';

const expectedNewFederationAddress = '2NGJ9Rhk5KqK1RwMZm7Uph6nhGFL5MYtpJo';

const expectedNewFederationErpRedeemScript = '0x64532102cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be12102f80abfd3dac069887f974ac033cb62991a0ed55b9880faf8b8cbd713b75d649e2103488898918c76758e52842c700060adbbbd0a38aa836838fd7215147b924ef7dc210362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1242103c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db55ae6702f401b2755321029cecea902067992d52c38b28bf0bb2345bda9b21eca76b16a17c477a64e433012103284178e5fbcc63c54c3b38e3ef88adf2da6c526313650041b0ef955763634ebd2103776b1fd8f86da3c1db3d69699e8250a15877d286734ea9a6da8e9d8ad25d16c12103ab0e2cd7ed158687fc13b88019990860cdb72b1f5777b58513312550ea1584bc2103b9fc46657cf72a1afa007ecf431de1cd27ff5cc8829fa625b66ca47b967e6b2455ae68';

const getCurrentFederationKeys = async (bridge) => {

    const activeFederationKeys = [];

    const activeFederationSize = Number(await bridge.methods.getFederationSize().call());

    for(let i = 0; i < activeFederationSize; i++) {

        const federatorBtcPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_BTC).call();
        const federatorRskPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_RSK).call();
        const federatorMstPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_MST).call();

        activeFederationKeys.push({
            [KEY_TYPE_BTC]: federatorBtcPublicKey,
            [KEY_TYPE_RSK]: federatorRskPublicKey,
            [KEY_TYPE_MST]: federatorMstPublicKey
        });
        
    }

    return activeFederationKeys;

};

const createNewFederationKeys = (currentFederationKeys) => {

    const newFederationKeys = [...currentFederationKeys];

    newFederationKeys.push({
        [KEY_TYPE_BTC]: newFederator1PublicKey,
        [KEY_TYPE_RSK]: newFederator1PublicKey,
        [KEY_TYPE_MST]: newFederator1PublicKey
    });

    newFederationKeys.push({
        [KEY_TYPE_BTC]: newFederator2PublicKey,
        [KEY_TYPE_RSK]: newFederator2PublicKey,
        [KEY_TYPE_MST]: newFederator2PublicKey
    });

    // Sort by btc public key
    newFederationKeys.sort((keyA, keyB) => keyA.btc.localeCompare(keyB.btc))

    return newFederationKeys;

};

const fundFedChangeAuthorizer = async (rskTxHelper, fedChangeAuthorizerAddress) => {
    await rskUtils.sendFromCow(rskTxHelper, fedChangeAuthorizerAddress, btcToWeis(0.1));
};

const getBtcPublicKeysInArray = (btcPublicKeysInString) => {
    return removePrefix0x(btcPublicKeysInString).match(/.{1,66}/g).map(key => ensure0x(key)) || [];
};

describe('Change federation', async function() {

    const regtestFedChangeAuthorizer1PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[0];
    const regtestFedChangeAuthorizer2PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[1];
    const regtestFedChangeAuthorizer3PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[2];

    let rskTxHelpers;
    let rskTxHelper;

    let fedChangeAuthorizer1Address;
    let fedChangeAuthorizer2Address;
    let fedChangeAuthorizer3Address;

    let activeFederationPublicKeys;
    let newFederationPublicKeys;

    let initialFederationAddress;

    let bridge;

    let commitFederationEvent;
  
    before(async () => {

        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];

        // Import the private keys of the federation change authorizers.
        fedChangeAuthorizer1Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer1PrivateKey);
        fedChangeAuthorizer2Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer2PrivateKey);
        fedChangeAuthorizer3Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer3PrivateKey);

        // Send some funds to the federation change authorizers to pay for transaction fees while voting.
        await fundFedChangeAuthorizer(rskTxHelper, fedChangeAuthorizer1Address);
        await fundFedChangeAuthorizer(rskTxHelper, fedChangeAuthorizer2Address);
        await fundFedChangeAuthorizer(rskTxHelper, fedChangeAuthorizer3Address);

        bridge = getBridge(rskTxHelper.getClient(), await getLatestActiveForkName());

        activeFederationPublicKeys = await getCurrentFederationKeys(bridge);
        newFederationPublicKeys = createNewFederationKeys(activeFederationPublicKeys);

        initialFederationAddress = await bridge.methods.getFederationAddress().call();
        
    });

    it('should create a pending federation', async () => {

        // Ensuring no pending federation exists yet.
        const pendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());
        expect(pendingFederationSize).to.be.equal(-1, 'No pending federation should exist yet.');

        const createFederationMethod = await bridge.methods.createFederation();

        // First create federation vote
        await rskUtils.sendTransaction(rskTxHelper, createFederationMethod, fedChangeAuthorizer1Address);
        
        // Second create federation vote
        await rskUtils.sendTransaction(rskTxHelper, createFederationMethod, fedChangeAuthorizer2Address);

        // Third and final create federation vote
        await rskUtils.sendTransaction(rskTxHelper, createFederationMethod, fedChangeAuthorizer3Address);

        const actualPendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());

        const expectedFederationSize = 0;

        expect(actualPendingFederationSize).to.be.equal(expectedFederationSize, `The pending federation should be created and have a size of ${expectedFederationSize}`);

    });

    it('should add federators public keys', async () => {

        for(let i = 0; i < newFederationPublicKeys.length; i++) {

            const federatorPublicKeysObj = newFederationPublicKeys[i];

            const addFederatorPublicKeyMultikeyMethod = bridge.methods.addFederatorPublicKeyMultikey(
                federatorPublicKeysObj[KEY_TYPE_BTC],
                federatorPublicKeysObj[KEY_TYPE_RSK],
                federatorPublicKeysObj[KEY_TYPE_MST]
            );

            // First add federator public key vote
            await rskUtils.sendTransaction(rskTxHelper, addFederatorPublicKeyMultikeyMethod, fedChangeAuthorizer1Address);

            // Second add federator public key vote
            await rskUtils.sendTransaction(rskTxHelper, addFederatorPublicKeyMultikeyMethod, fedChangeAuthorizer2Address);

            // Third and final add federator public key vote
            await rskUtils.sendTransaction(rskTxHelper, addFederatorPublicKeyMultikeyMethod, fedChangeAuthorizer3Address);

        }

        const expectedPendingFederationSize = newFederationPublicKeys.length;

        const actualPendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());

        expect(actualPendingFederationSize).to.be.equal(expectedPendingFederationSize, `The pending federation should have a size of ${expectedPendingFederationSize}`);

    });

    it('should commit the pending federation', async () => {

        const pendingFederationHash = await bridge.methods.getPendingFederationHash().call();

        expect(pendingFederationHash).to.be.equal(expectedPendingFederationHash, 'The pending federation hash should be the expected.').to.not.be.null;

        const commitPendingFederationMethod = bridge.methods.commitFederation(pendingFederationHash);

        // First commit pending federation vote
        await rskUtils.sendTransaction(rskTxHelper, commitPendingFederationMethod, fedChangeAuthorizer1Address);

        // Second commit pending federation vote
        await rskUtils.sendTransaction(rskTxHelper, commitPendingFederationMethod, fedChangeAuthorizer2Address);

        // Third and final commit pending federation vote
        const commitFederationTransactionReceipt = await rskUtils.sendTransaction(rskTxHelper, commitPendingFederationMethod, fedChangeAuthorizer3Address);

        const bridgeTransaction = await bridgeTxParser.getBridgeTransactionByTxHash(rskTxHelper.getClient(), commitFederationTransactionReceipt.transactionHash);

        commitFederationEvent = bridgeTransaction.events.find(event => event.name === 'commit_federation');
        expect(commitFederationEvent, 'The commit federation event should be emitted.').to.not.be.null;

        // Assert the old federation address in the commit federation event is the initial one.
        const oldFederationAddress = commitFederationEvent.arguments.oldFederationBtcAddress;
        expect(oldFederationAddress).to.be.equal(initialFederationAddress, 'The old federation address in the commit_federation event should now be the same as the initial.');

        // Assert the new federation address in the commit federation event is the expected one.
        const newActiveFederationAddress = commitFederationEvent.arguments.newFederationBtcAddress;
        expect(newActiveFederationAddress).to.be.equal(expectedNewFederationAddress, 'The new federation address in the commit_federation event should be the expected one.');

        // Assert the new federation btc public keys in the commit federation event are the expected ones.
        const expectedNewFederationBtcPublicKeys = newFederationPublicKeys.map(federator => federator[KEY_TYPE_BTC]);
        const newFederationBtcPublicKeysInString = commitFederationEvent.arguments.newFederationBtcPublicKeys;
        const actualNewFederationBtcPublicKeys = getBtcPublicKeysInArray(newFederationBtcPublicKeysInString);
        expect(actualNewFederationBtcPublicKeys).to.be.deep.equal(expectedNewFederationBtcPublicKeys, 'The new federation btc public keys should be the expected ones.');

    });

    it('should activate federation', async () => {

        const federationActivationBlockNumber = commitFederationEvent.arguments.activationHeight;
        const currentBlockNumber = await rskTxHelper.getClient().eth.getBlockNumber();
        const blockDifference = federationActivationBlockNumber - currentBlockNumber;
        // Mining enough blocks to active the federation.
        await rskUtils.mineAndSync(rskTxHelpers, blockDifference + 1);

        // Assert the pending federation does not exist anymore.
        const actualPendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());
        const expectedFederationSize = -1;
        expect(actualPendingFederationSize).to.be.equal(expectedFederationSize, 'The pending federation should not exist anymore.');

        // Assert the active federation address is the expected one.
        const newFederationAddress = await bridge.methods.getFederationAddress().call();
        expect(newFederationAddress).to.not.be.equal(initialFederationAddress, 'The new active federation address should be different from the initial federation address.');
        expect(newFederationAddress).to.be.equal(expectedNewFederationAddress, 'The new active federation address should be the expected one.');

        // Assert the active federation redeem script is the expected ones.
        const newActiveFederaetionErpRedeemScript = await bridge.methods.getActivePowpegRedeemScript().call();
        expect(newActiveFederaetionErpRedeemScript).to.be.equal(expectedNewFederationErpRedeemScript, 'The new active federation erp redeem script should be the expected one.');

    });

});
