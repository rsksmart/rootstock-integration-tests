const { expect } = require('chai');
const bitcoinJsLib = require('bitcoinjs-lib');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const { parseRLPToPegoutWaitingSignatures } = require('@rsksmart/bridge-state-data-parser/pegout-waiting-signature');
const { btcToWeis, satoshisToBtc } = require('@rsksmart/btc-eth-unit-converter');
const BridgeTransactionParser = require('@rsksmart/bridge-transaction-parser');
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBridge } = require('../lib/bridge-provider');
const {
    removePrefix0x,
    ensure0x,
    splitStringIntoChunks,
    getBridgeStorageValueDecodedHexString,
    decodeRlp,
} = require('../lib/utils');
const { 
    KEY_TYPE_BTC, 
    KEY_TYPE_RSK, 
    KEY_TYPE_MST,
    REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS,
    FEDERATION_ACTIVATION_AGE,
    FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END,
    ERP_PUBKEYS,
    ERP_CSV_VALUE,
    svpFundTxHashUnsignedStorageIndex,
    svpFundTxSignedStorageIndex,
    svpSpendTxHashUnsignedStorageIndex,
    svpSpendTxWaitingForSignaturesStorageIndex,
} = require('../lib/constants/federation-constants');
const {
    createSenderRecipientInfo,
    sendPegin,
    ensurePeginIsRegistered
} = require('../lib/2wp-utils');
const { BRIDGE_ADDRESS } = require('../lib/bridge-constants');
const { getBtcClient } = require('../lib/btc-client-provider');
const { MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS, PEGOUT_EVENTS } = require('../lib/constants/pegout-constants');
const {
    getActiveFederationPublicKeys,
    getProposedFederationInfo,
    getProposedFederationPublicKeys
} = require('../lib/federation-utils');
const { decodeOutpointValues } = require('../lib/varint');

// Generated with seed newFed1
const newFederator1PublicKey = '0x02f80abfd3dac069887f974ac033cb62991a0ed55b9880faf8b8cbd713b75d649e';
// Generated with seed newFed2
const newFederator2PublicKey = '0x03488898918c76758e52842c700060adbbbd0a38aa836838fd7215147b924ef7dc';

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
    newFederationKeys.sort((keyA, keyB) => keyA.btc.localeCompare(keyB.btc));

    return newFederationKeys;

};

const fundFedChangeAuthorizer = async (rskTxHelper, fedChangeAuthorizerAddress) => {
    await rskUtils.sendFromCow(rskTxHelper, fedChangeAuthorizerAddress, btcToWeis(0.1));
};

const parseBtcPublicKeys = (btcPublicKeysInString) => {
    const publicKeyLengthWithoutOxPrefix = 66;
    const btcPublicKeysStringWithout0x = removePrefix0x(btcPublicKeysInString);
    const btcPublicKeysInArray = splitStringIntoChunks(btcPublicKeysStringWithout0x, publicKeyLengthWithoutOxPrefix);
    const btcPublicKeysInArrayWith0xPrefix = btcPublicKeysInArray.map(key => ensure0x(key));
    return btcPublicKeysInArrayWith0xPrefix;
};

describe('Change federation', async function() {

    let rskTxHelpers;
    let rskTxHelper;
    let bridge;
    let bridgeTxParser;
    let btcTxHelper;

    const regtestFedChangeAuthorizer1PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[0];
    const regtestFedChangeAuthorizer2PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[1];
    const regtestFedChangeAuthorizer3PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[2];

    let fedChangeAuthorizer1Address;
    let fedChangeAuthorizer2Address;
    let fedChangeAuthorizer3Address;
    let initialFederationPublicKeys;
    let newFederationPublicKeys;
    let newFederationBtcPublicKeys;
    let initialFederationAddress;
    let commitFederationEvent;
    let expectedNewFederationAddress;
    let commitFederationCreationBlockNumber;
    let expectedNewFederationErpRedeemScript;
    let minimumPeginValueInSatoshis;
    let expectedFlyoverAddress;

    before(async () => {

        rskTxHelpers = getRskTransactionHelpers();
        rskTxHelper = rskTxHelpers[0];
        bridgeTxParser = new BridgeTransactionParser(rskTxHelper.getClient());
        btcTxHelper = getBtcClient();

        // Import the private keys of the federation change authorizers.
        fedChangeAuthorizer1Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer1PrivateKey);
        fedChangeAuthorizer2Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer2PrivateKey);
        fedChangeAuthorizer3Address = await rskTxHelper.importAccount(regtestFedChangeAuthorizer3PrivateKey);

        // Send some funds to the federation change authorizers to pay for transaction fees while voting.
        await fundFedChangeAuthorizer(rskTxHelper, fedChangeAuthorizer1Address);
        await fundFedChangeAuthorizer(rskTxHelper, fedChangeAuthorizer2Address);
        await fundFedChangeAuthorizer(rskTxHelper, fedChangeAuthorizer3Address);

        bridge = getBridge(rskTxHelper.getClient());

        initialFederationPublicKeys = await getActiveFederationPublicKeys(bridge);
        newFederationPublicKeys = createNewFederationKeys(initialFederationPublicKeys);
        newFederationBtcPublicKeys = newFederationPublicKeys.map(federator => federator[KEY_TYPE_BTC]);
        const expectedNewFederationErpRedeemScriptBuffer = redeemScriptParser.getP2shErpRedeemScript(newFederationBtcPublicKeys.map(key => removePrefix0x(key)), ERP_PUBKEYS, ERP_CSV_VALUE);
        expectedNewFederationErpRedeemScript = expectedNewFederationErpRedeemScriptBuffer.toString('hex');
        expectedNewFederationAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', expectedNewFederationErpRedeemScriptBuffer);

        const flyoverPowpegRedeemScript = redeemScriptParser.getFlyoverRedeemScript(expectedNewFederationErpRedeemScriptBuffer, "0000000000000000000000000000000000000000000000000000000000000001");
        expectedFlyoverAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', flyoverPowpegRedeemScript);

        initialFederationAddress = await bridge.methods.getFederationAddress().call();

        minimumPeginValueInSatoshis = Number(await bridge.methods.getMinimumLockTxValue().call());

        // Making a donation pegin to the Bridge to ensure there is enough utxo value to create the SVP fund transaction.
        const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'legacy', satoshisToBtc(minimumPeginValueInSatoshis) * 2);
        const btcPeginTxHash = await sendPegin(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(minimumPeginValueInSatoshis));
        await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);

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

    it('should create the proposed federation', async () => {

        const proposedFederationInfo = await getProposedFederationInfo(bridge);

        const expectedProposedFederationSize = newFederationPublicKeys.length;
        expect(proposedFederationInfo.proposedFederationSize).to.be.equal(expectedProposedFederationSize, 'The proposed federation size should be the expected one.');

        expect(proposedFederationInfo.proposedFederationAddress).to.be.equal(expectedNewFederationAddress, 'The proposed federation address should be the expected one.');

        expect(proposedFederationInfo.proposedFederationCreationBlockNumber).to.be.equal(commitFederationCreationBlockNumber, 'The proposed federation creation block number should be the expected one.');
        
        const proposedFederationMembers = await getProposedFederationPublicKeys(bridge);

        expect(proposedFederationMembers).to.be.deep.equal(newFederationPublicKeys, 'The proposed federation public keys should be the expected ones.');

    });

    it('should not have created svp transaction and there should not be any SVP values in storage yet', async () => {

        // Assert

        const bridgeState = await getBridgeState(rskTxHelper.getClient());

        expect(bridgeState.pegoutsWaitingForConfirmations.length).to.be.equal(0, 'No pegout should be waiting for confirmations.');
        expect(bridgeState.pegoutsWaitingForSignatures.length).to.be.equal(0, 'No pegout should be waiting for signatures.');

        await assertSvpValuesNotPresentInStorage(rskTxHelper);

    });

    it('should create the SVP Fund transaction on the next updateCollections call', async () => {

        // Act

        const initialBridgeState = await getBridgeState(rskTxHelper.getClient());

        await rskUtils.waitAndUpdateBridge(rskTxHelper);

        const finalBridgeState = await getBridgeState(rskTxHelper.getClient());

        // Assert

        // The SVP fund transaction should be created and put in waiting for confirmations.
        expect(finalBridgeState.pegoutsWaitingForConfirmations.length).to.be.equal(1, 'There should be one pegout waiting for confirmations.');
        expect(finalBridgeState.pegoutsWaitingForSignatures.length).to.be.equal(0, 'No pegout should be waiting for signatures.');

        const svpPegoutWaitingForConfirmations = finalBridgeState.pegoutsWaitingForConfirmations[0];

        const pegoutCreationBlockNumber = Number(svpPegoutWaitingForConfirmations.pegoutCreationBlockNumber);

        const expectedPegoutCreationBlockNumber = commitFederationCreationBlockNumber + 1;
        expect(pegoutCreationBlockNumber).to.be.equal(expectedPegoutCreationBlockNumber, 'The svp fund tx pegout creation block number should be the block that contains the first updateCollections call right after the commitFederation call.');

        const rawSvpBtcTransaction = svpPegoutWaitingForConfirmations.btcRawTx;

        const btcTransaction = bitcoinJsLib.Transaction.fromHex(rawSvpBtcTransaction);

        expect(btcTransaction.outs.length).to.be.equal(3, 'The SVP fund transaction should have 3 outputs.');

        const proposedFederationAddress = await bridge.methods.getProposedFederationAddress().call();

        // The output addresses should be in the expected order.
        const proposedFederationOutput = btcTransaction.outs[0];
        const proposedFederationFlyoverOutput = btcTransaction.outs[1];
        const activeFederationOutput = btcTransaction.outs[2];

        const actualProposedFederationAddress = bitcoinJsLib.address.fromOutputScript(proposedFederationOutput.script, btcTxHelper.btcConfig.network);
        expect(actualProposedFederationAddress).to.be.equal(proposedFederationAddress, 'The proposed federation address in the SVP fund transaction should be the first output.');

        const actualProposedFederationFlyoverAddress = bitcoinJsLib.address.fromOutputScript(proposedFederationFlyoverOutput.script, btcTxHelper.btcConfig.network);
        expect(actualProposedFederationFlyoverAddress).to.be.equal(expectedFlyoverAddress, 'The flyover address in the SVP fund transaction should be the second expected output.');

        const actualActiveFederationAddress = bitcoinJsLib.address.fromOutputScript(activeFederationOutput.script, btcTxHelper.btcConfig.network);
        expect(actualActiveFederationAddress).to.be.equal(initialFederationAddress, 'The active federation address in the SVP fund transaction should be the third output.');

        // The proposed federation and flyover addresses output values should be double the minimum pegout value.
        const expectedProposedFederationOutputValue = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS * 2;
        expect(proposedFederationOutput.value).to.be.equal(expectedProposedFederationOutputValue, 'The proposed federation output value should be double the minimum pegout value.');

        const expectedFlyoverOutputValue = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS * 2;
        expect(proposedFederationFlyoverOutput.value).to.be.equal(expectedFlyoverOutputValue, 'The flyover output value should be double the minimum pegout value.');

        // Only the svp fund tx hash unsigned value should be in storage
        await assertOnlySvpFundTxHashUnsignedIsInStorage(rskTxHelper, btcTransaction.getId());

        // The release_requested event should be emitted with the expected values
        const releaseRequestedEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_REQUESTED.name, expectedPegoutCreationBlockNumber);
        const expectedReleaseRequestedAmount = expectedProposedFederationOutputValue + expectedFlyoverOutputValue;
        expect(Number(releaseRequestedEvent.arguments.amount)).to.be.equal(expectedReleaseRequestedAmount, 'The amount in the release requested event should be the sum of the proposed federation and flyover output values.');
        expect(releaseRequestedEvent, 'The release requested event should be emitted.').to.not.be.null;
        expect(removePrefix0x(releaseRequestedEvent.arguments.btcTxHash)).to.be.equal(btcTransaction.getId(), 'The btc tx hash in the release requested event should be the tx id of the SVP fund tx.');
       
        // The pegout_transaction_created event should be emitted with the expected values
        const pegoutTransactionCreatedEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.PEGOUT_TRANSACTION_CREATED.name, expectedPegoutCreationBlockNumber);
        expect(pegoutTransactionCreatedEvent, 'The pegout transaction created event should be emitted.').to.not.be.null;
        expect(removePrefix0x(pegoutTransactionCreatedEvent.arguments.btcTxHash)).to.be.equal(btcTransaction.getId(), 'The btc tx hash in the pegout transaction created event should be the tx id of the SVP fund tx.');
       
        await assertPegoutTransactionCreatedOutpointValues(initialBridgeState, finalBridgeState, btcTransaction, pegoutTransactionCreatedEvent);

    });

    it('should release and register the svp fund transaction and create the svp spend transaction', async () => {

        // Mining to have enough confirmations for the SVP fund transaction and updating the bridge.
        await rskTxHelper.mine(3);
        await rskUtils.waitAndUpdateBridge(rskTxHelper);

        const initialBridgeState = await getBridgeState(rskTxHelper.getClient());
        expect(initialBridgeState.pegoutsWaitingForSignatures.length).to.be.equal(1, 'The svp fund transaction should be waiting for signatures.');

        const blockNumberBeforeRelease = await rskTxHelper.getBlockNumber();
        await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);
        const blockNumberAfterRelease = await rskTxHelper.getBlockNumber();
        const releaseBtcEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_BTC.name, blockNumberBeforeRelease, blockNumberAfterRelease);

        const releaseBtcTransaction = bitcoinJsLib.Transaction.fromHex(removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction));
        const finalBridgeState = await getBridgeState(rskTxHelper.getClient());
        const registeredSvpFundTxUtxo = finalBridgeState.activeFederationUtxos.find(utxo => utxo.btcTxHash === releaseBtcTransaction.getId());
        expect(registeredSvpFundTxUtxo, 'The SVP fund tx should be registered in the Bridge by now.').to.not.be.undefined;

        const utxoToActiveFederation = releaseBtcTransaction.outs[2];
        expect(registeredSvpFundTxUtxo.valueInSatoshis).to.be.equal(utxoToActiveFederation.value, 'The SVP fund tx registered utxo value should be the same as the utxo to the active federation.');

        await assertOnlySvpSpendTxValuesAreInStorage(rskTxHelper);

        await assertProposedFederationIsStillInStorage(bridge, expectedNewFederationAddress, newFederationPublicKeys);

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

const assertSvpValuesNotPresentInStorage = async (rskTxHelper) => {

    const svpFundTxHashUnsigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpFundTxHashUnsignedStorageIndex);
    expect(svpFundTxHashUnsigned).to.be.equal('0x0', 'The SVP fund tx hash unsigned storage value should be empty.');

    const svpFundTxSigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpFundTxSignedStorageIndex);
    expect(svpFundTxSigned).to.be.equal('0x0', 'The SVP fund tx signed storage value should be empty.');

    const svpSpendTxHashUnsigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxHashUnsignedStorageIndex);
    expect(svpSpendTxHashUnsigned).to.be.equal('0x0', 'The SVP spend tx hash unsigned storage value should be empty.');

    const svpSpendTxWaitingForSignatures = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxWaitingForSignaturesStorageIndex);
    expect(svpSpendTxWaitingForSignatures).to.be.equal('0x0', 'The SVP spend tx waiting for signatures storage value should be empty.');

};

const assertOnlySvpFundTxHashUnsignedIsInStorage = async (rskTxHelper, pegoutBtcTxHash) => {

    const svpFundTxHashUnsignedRlpEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpFundTxHashUnsignedStorageIndex);
    const svpFundTxHashUnsigned = getBridgeStorageValueDecodedHexString(svpFundTxHashUnsignedRlpEncoded, false);
    expect(svpFundTxHashUnsigned).to.be.equal(pegoutBtcTxHash, 'The SVP fund tx hash unsigned storage value should be the tx id of the SVP fund tx.');

    const svpFundTxSigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpFundTxSignedStorageIndex);
    expect(svpFundTxSigned).to.be.equal('0x0', 'The SVP fund tx signed storage value should be empty.');

    const svpSpendTxHashUnsigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxHashUnsignedStorageIndex);
    expect(svpSpendTxHashUnsigned).to.be.equal('0x0', 'The SVP spend tx hash unsigned storage value should be empty.');

    const svpSpendTxWaitingForSignatures = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxWaitingForSignaturesStorageIndex);
    expect(svpSpendTxWaitingForSignatures).to.be.equal('0x0', 'The SVP spend tx waiting for signatures storage value should be empty.');

};

const assertOnlySvpSpendTxValuesAreInStorage = async (rskTxHelper) => {

    const svpFundTxHashUnsignedRlpEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpFundTxHashUnsignedStorageIndex);
    expect(svpFundTxHashUnsignedRlpEncoded).to.be.equal('0x0', 'The SVP fund tx hash unsigned storage value should be empty.');

    const svpFundTxSigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpFundTxSignedStorageIndex);
    expect(svpFundTxSigned).to.be.equal('0x0', 'The SVP fund tx signed storage value should be empty.');

    const svpSpendTxHashUnsigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxHashUnsignedStorageIndex);
    expect(svpSpendTxHashUnsigned).to.not.be.equal('0x0', 'The SVP spend tx hash unsigned storage value should not be empty.');
    const svpSpendTxHashUnsignedDecoded = decodeRlp(svpSpendTxHashUnsigned).toString('hex');

    const svpSpendTxWaitingForSignatures = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxWaitingForSignaturesStorageIndex);
    expect(svpSpendTxWaitingForSignatures).to.not.be.equal('0x0', 'The SVP spend tx waiting for signatures storage value should not be empty.');

    const decodedSvpSpendTxWaitingForSignature = parseRLPToPegoutWaitingSignatures(svpSpendTxWaitingForSignatures)[0];
    const svpSpendBtcTx = bitcoinJsLib.Transaction.fromHex(removePrefix0x(decodedSvpSpendTxWaitingForSignature.btcRawTx));
    expect(svpSpendTxHashUnsignedDecoded).to.be.equal(svpSpendBtcTx.getId(), 'The SVP spend tx hash unsigned storage value should be the tx id of the SVP spend tx.');

};

const assertPegoutTransactionCreatedOutpointValues = async (initialBridgeState, finalBridgeState, svpBtcTransaction, pegoutTransactionCreatedEvent) => {

    const svpFundTxInput = svpBtcTransaction.ins[0];
    const svpFundTxInputIndex = svpFundTxInput.index;
    const svpFundTxInputTxHash = svpFundTxInput.hash.reverse().toString('hex');

    expect(finalBridgeState.activeFederationUtxos.length).to.be.equal(initialBridgeState.activeFederationUtxos.length - 1, 'There should be one less active federation utxo.');

    // Asserting that the expected utxo was used up and removed from the Bridge
    const svpFundTxUtxoInInitialBridgeState = initialBridgeState.activeFederationUtxos.find(utxo => utxo.btcTxHash === svpFundTxInputTxHash && utxo.btcTxOutputIndex === svpFundTxInputIndex);
    expect(svpFundTxUtxoInInitialBridgeState).to.not.be.undefined;
    const svpFundTxUtxoInFinalridgeState = finalBridgeState.activeFederationUtxos.find(utxo => utxo.btcTxHash === svpFundTxInputTxHash && utxo.btcTxOutputIndex === svpFundTxInputIndex);
    expect(svpFundTxUtxoInFinalridgeState).to.be.undefined;

    // Asserting the outpoint values in the pegout transaction created event are the same as the used up utxo value
    const encodedUtxoOutpointValues = Buffer.from(removePrefix0x(pegoutTransactionCreatedEvent.arguments.utxoOutpointValues), 'hex');
    const outpointValues = decodeOutpointValues(encodedUtxoOutpointValues);
    expect(outpointValues.length).to.be.equal(1);
    const outpointValue = outpointValues[0];
    expect(Number(outpointValue)).to.be.equal(svpFundTxUtxoInInitialBridgeState.valueInSatoshis, 'The outpoint value should be the same as the utxo value.');

};

const assertProposedFederationIsStillInStorage = async (bridge, expectedProposedFederationAddress, expectedProposedFederationMembers) => {

    const proposedFederationAddress = await bridge.methods.getProposedFederationAddress().call();
    expect(proposedFederationAddress).to.be.equal(expectedProposedFederationAddress, 'The proposed federation address should still be in storage.');

    const proposedFederationMembers = await getProposedFederationPublicKeys(bridge);
    expect(proposedFederationMembers).to.be.deep.equal(expectedProposedFederationMembers, 'The proposed federation members should still be in storage.');

};
