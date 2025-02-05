const rskUtils = require('../rsk-utils');
const { getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const { getBridge } = require('../bridge-provider');
const { btcToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { removePrefix0x, ensure0x, splitStringIntoChunks } = require('../utils');
const BridgeTransactionParser = require('@rsksmart/bridge-transaction-parser');
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { expect } = require('chai');
const { 
    KEY_TYPE_BTC, 
    KEY_TYPE_RSK, 
    KEY_TYPE_MST,
    REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS,
    FEDERATION_ACTIVATION_AGE,
    FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END,
    ERP_PUBKEYS,
    ERP_CSV_VALUE,
} = require('../constants/federation-constants');
const {
    getNewFederationPublicKeysFromNewFederationConfig,
    stopPreviousFederators,
    startNewFederationNodes,
    fundNewFederators,
} = require('../federation-utils');
const { getBtcClient } = require('../btc-client-provider');

const getCurrentFederationKeys = async (bridge) => {

    const initialFederationKeys = [];

    const initialFederationSize = Number(await bridge.methods.getFederationSize().call());

    for(let i = 0; i < initialFederationSize; i++) {

        const federatorBtcPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_BTC).call();
        const federatorRskPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_RSK).call();
        const federatorMstPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_MST).call();

        initialFederationKeys.push({
            [KEY_TYPE_BTC]: federatorBtcPublicKey,
            [KEY_TYPE_RSK]: federatorRskPublicKey,
            [KEY_TYPE_MST]: federatorMstPublicKey
        });
        
    }

    return initialFederationKeys;

};

const parseBtcPublicKeys = (btcPublicKeysInString) => {
    const publicKeyLengthWithoutOxPrefix = 66;
    const btcPublicKeysStringWithout0x = removePrefix0x(btcPublicKeysInString);
    const btcPublicKeysInArray = splitStringIntoChunks(btcPublicKeysStringWithout0x, publicKeyLengthWithoutOxPrefix);
    const btcPublicKeysInArrayWith0xPrefix = btcPublicKeysInArray.map(key => ensure0x(key));
    return btcPublicKeysInArrayWith0xPrefix;
};

const execute = (description, newFederationConfig) => {

    describe(description, async function() {

        let rskTxHelpers;
        let rskTxHelper;
        let bridge;
        let bridgeTxParser;

        const regtestFedChangeAuthorizer1PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[0];
        const regtestFedChangeAuthorizer2PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[1];
        const regtestFedChangeAuthorizer3PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[2];

        let fedChangeAuthorizer1Address;
        let fedChangeAuthorizer2Address;
        let fedChangeAuthorizer3Address;
        let initialFederationPublicKeys;
        let newFederationBtcPublicKeys;
        let initialFederationAddress;
        let commitFederationEvent;
        let expectedNewFederationAddress;
        let commitFederationCreationBlockNumber;
        let expectedNewFederationErpRedeemScript;
        let newFederationPublicKeys;
        let btcTxHelper;
    
        before(async () => {

            await startNewFederationNodes(newFederationConfig.members);

            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            bridgeTxParser = new BridgeTransactionParser(rskTxHelper.getClient());
            btcTxHelper = getBtcClient();

            await fundNewFederators(rskTxHelper, newFederationConfig.members);

            await rskUtils.waitForSync(rskTxHelpers);

            // Import the private keys of the federation change authorizers.
            fedChangeAuthorizer1Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer1PrivateKey);
            fedChangeAuthorizer2Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer2PrivateKey);
            fedChangeAuthorizer3Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer3PrivateKey);

            // Send some funds to the federation change authorizers to pay for transaction fees while voting.
            await rskUtils.sendFromCow(rskTxHelper, fedChangeAuthorizer1Address, btcToWeis(0.1));
            await rskUtils.sendFromCow(rskTxHelper, fedChangeAuthorizer2Address, btcToWeis(0.1));
            await rskUtils.sendFromCow(rskTxHelper, fedChangeAuthorizer3Address, btcToWeis(0.1));

            bridge = await getBridge(rskTxHelper.getClient());

            initialFederationPublicKeys = await getCurrentFederationKeys(bridge);
            newFederationPublicKeys = getNewFederationPublicKeysFromNewFederationConfig(newFederationConfig);
            newFederationBtcPublicKeys = newFederationPublicKeys.map(federator => federator[KEY_TYPE_BTC]);

            const expectedNewFederationErpRedeemScriptBuffer = redeemScriptParser.getP2shErpRedeemScript(newFederationBtcPublicKeys.map(key => removePrefix0x(key)), ERP_PUBKEYS, ERP_CSV_VALUE);
            expectedNewFederationErpRedeemScript = expectedNewFederationErpRedeemScriptBuffer.toString('hex');
            expectedNewFederationAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', expectedNewFederationErpRedeemScriptBuffer);

            initialFederationAddress = await bridge.methods.getFederationAddress().call();

            await btcTxHelper.importAddress(initialFederationAddress, 'federations');
            await btcTxHelper.importAddress(expectedNewFederationAddress, 'federations');

        });

        it('should create a pending federation', async () => {

            // Ensuring no pending federation exists yet.
            const pendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());
            const expectedPendingFederationSize = -1;
            expect(pendingFederationSize).to.be.equal(expectedPendingFederationSize, 'No pending federation should exist yet.');

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

            for(const federatorPublicKeysObj of newFederationPublicKeys) {

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

            const commitPendingFederationMethod = bridge.methods.commitFederation(pendingFederationHash);

            // First commit pending federation vote
            await rskUtils.sendTransaction(rskTxHelper, commitPendingFederationMethod, fedChangeAuthorizer1Address);

            // Second commit pending federation vote
            await rskUtils.sendTransaction(rskTxHelper, commitPendingFederationMethod, fedChangeAuthorizer2Address);

            // Third and final commit pending federation vote
            const commitFederationTransactionReceipt = await rskUtils.sendTransaction(rskTxHelper, commitPendingFederationMethod, fedChangeAuthorizer3Address);

            const bridgeTransaction = await bridgeTxParser.getBridgeTransactionByTxHash(commitFederationTransactionReceipt.transactionHash);

            commitFederationEvent = bridgeTransaction.events.find(event => event.name === 'commit_federation');
            expect(commitFederationEvent, 'The commit federation event should be emitted.').to.not.be.null;

            const expectedActivationHeight = bridgeTransaction.blockNumber + FEDERATION_ACTIVATION_AGE;
            const actualActivationHeight = Number(commitFederationEvent.arguments.activationHeight);
            expect(actualActivationHeight).to.be.equal(expectedActivationHeight, 'The activation height should be the expected one.');

            commitFederationCreationBlockNumber = bridgeTransaction.blockNumber;

            // Assert the old federation address in the commit federation event is the initial one.
            const oldFederationAddress = commitFederationEvent.arguments.oldFederationBtcAddress;
            expect(oldFederationAddress).to.be.equal(initialFederationAddress, 'The old federation address in the commit_federation event should now be the same as the initial.');

            // Assert the new federation address in the commit federation event is the expected one.
            const newActiveFederationAddress = commitFederationEvent.arguments.newFederationBtcAddress;
            expect(newActiveFederationAddress).to.be.equal(expectedNewFederationAddress, 'The new federation address in the commit_federation event should be the expected one.');

            // Assert the new federation btc public keys in the commit federation event are the expected ones.
            const newFederationBtcPublicKeysInString = commitFederationEvent.arguments.newFederationBtcPublicKeys;
            const actualNewFederationBtcPublicKeys = parseBtcPublicKeys(newFederationBtcPublicKeysInString);
            expect(actualNewFederationBtcPublicKeys).to.be.deep.equal(newFederationBtcPublicKeys, 'The new federation btc public keys should be the expected ones.');

            // Assert the old federation btc public keys in the commit federation event are the expected ones.
            const oldFederationBtcPublicKeysInString = commitFederationEvent.arguments.oldFederationBtcPublicKeys;
            const actualOldFederationBtcPublicKeys = parseBtcPublicKeys(oldFederationBtcPublicKeysInString);
            expect(actualOldFederationBtcPublicKeys).to.be.deep.equal(initialFederationPublicKeys.map(federator => federator[KEY_TYPE_BTC]), 'The old federation btc public keys should be the expected ones.');

        });

        it('should activate federation', async () => {

            const federationActivationBlockNumber = commitFederationCreationBlockNumber + FEDERATION_ACTIVATION_AGE;

            const currentBlockNumber = await rskTxHelper.getClient().eth.getBlockNumber();
            const blockDifference = federationActivationBlockNumber - currentBlockNumber;
            // Mining enough blocks to activate the federation.
            await rskUtils.mineAndSync(rskTxHelpers, blockDifference + 1);

            // Assert the pending federation does not exist anymore.
            const actualPendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());
            const expectedFederationSize = -1;
            expect(actualPendingFederationSize).to.be.equal(expectedFederationSize, 'The pending federation should not exist anymore.');

            // Assert the active federation redeem script is the expected ones.
            const newActiveFederationErpRedeemScript = removePrefix0x(await bridge.methods.getActivePowpegRedeemScript().call());
            expect(newActiveFederationErpRedeemScript).to.be.equal(expectedNewFederationErpRedeemScript, 'The new active federation erp redeem script should be the expected one.');

            // Assert the active federation address is the expected one.
            const newFederationAddress = await bridge.methods.getFederationAddress().call();
            expect(newFederationAddress).to.not.be.equal(initialFederationAddress, 'The new active federation address should be different from the initial federation address.');
            expect(newFederationAddress).to.be.equal(expectedNewFederationAddress, 'The new active federation address should be the expected one.');

            const retiringFederationSize = Number(await bridge.methods.getRetiringFederationSize().call());
            expect(retiringFederationSize).to.be.equal(initialFederationPublicKeys.length, 'The retiring federation size should be the same as the initial federation size.');

            const retiringFederationAddress = await bridge.methods.getRetiringFederationAddress().call();
            expect(retiringFederationAddress).to.be.equal(initialFederationAddress, 'The retiring federation address should be the initial federation address.');

        });

        it('should complete retiring the old federation', async () => {

            await rskUtils.waitForSync(rskTxHelpers);
            await stopPreviousFederators(newFederationConfig);
            
            // The first federates are no longer part of the new federation, so we need to recreate the following instances to exclude them.
            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            bridge = await getBridge(rskTxHelper.getClient());

            const blocksToMineToRetireFederation = FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END;
            // Mining enough blocks to complete retiring the old federation.
            await rskUtils.mineAndSync(rskTxHelpers, blocksToMineToRetireFederation);

            // Updating bridge since this is required for the retiring federation to be removed.
            await rskUtils.waitAndUpdateBridge(rskTxHelper);

            // Assert the retiring federation does not exist anymore.
            const actualRetiringFederationSize = Number(await bridge.methods.getRetiringFederationSize().call());
            const expectedRetiringFederationSize = -1;
            expect(actualRetiringFederationSize).to.be.equal(expectedRetiringFederationSize, 'The retiring federation should not exist anymore.');
        
        });

    });

};

module.exports = {
    execute,
};
