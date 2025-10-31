const rskUtils = require('../rsk-utils');
const bitcoinJsLib = require('bitcoinjs-lib');
const { parseRLPToPegoutWaitingSignatures } = require('@rsksmart/bridge-state-data-parser/pegout-waiting-signature');
const { parseRLPToActiveFederationUtxos } = require('@rsksmart/bridge-state-data-parser/active-federation-utxos');
const BN = require('bn.js');
const { getRskTransactionHelper, getRskTransactionHelpers } = require('../rsk-tx-helper-provider');
const { getBridge } = require('../bridge-provider');
const {
    removePrefix0x,
    ensure0x,
    splitStringIntoChunks,
    wait,
    getBridgeStorageValueDecodedHexString,
    decodeRlp,
    retryWithCheck,
} = require('../utils');
const BridgeTransactionParser = require('@rsksmart/bridge-transaction-parser');
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { btcToWeis, satoshisToBtc, satoshisToWeis } = require('@rsksmart/btc-eth-unit-converter');
const { expect } = require('chai');
const { BRIDGE_ADDRESS, FLYOVER_DERIVATION_HASH } = require('../constants/bridge-constants');
const { 
    KEY_TYPE_BTC, 
    KEY_TYPE_RSK, 
    KEY_TYPE_MST,
    REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS,
    FEDERATION_ACTIVATION_AGE,
    FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END,
    ERP_PUBKEYS,
    ERP_CSV_VALUE,
    FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_BEGIN,
    svpFundTxHashUnsignedStorageIndex,
    svpFundTxSignedStorageIndex,
    svpSpendTxHashUnsignedStorageIndex,
    svpSpendTxWaitingForSignaturesStorageIndex,
    oldFederationBtcUTXOSStorageIndex,
    VALIDATION_PERIOD_DURATION_IN_BLOCKS,
    FEDERATION_EVENTS,
} = require('../constants/federation-constants');
const {
    getNewFederationPublicKeysFromNewFederationConfig,
    stopPreviousFederators,
    startNewFederationNodes,
    fundNewFederators,
    getProposedFederationInfo,
    getProposedFederationPublicKeys,
    getRetiringFederationInfo,
    getActiveFederationPublicKeys,
    getActiveFederationInfo,
    getRetiringFederationPublicKeys,
} = require('../federation-utils');
const { getBtcClient } = require('../btc-client-provider');
const { PEGOUT_EVENTS, MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS } = require('../constants/pegout-constants');
const {
    createSenderRecipientInfo,
    ensurePeginIsRegistered,
    BTC_TO_RSK_MINIMUM_CONFIRMATIONS,
    get2wpBalances,
    sendPeginToActiveFederation,
    sendPeginToRetiringFederation,
    sendPeginToActiveAndRetiringFederations,
} = require('../2wp-utils');
const { assert2wpBalancesAfterSuccessfulPegin } = require('../assertions/2wp');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const { waitForBitcoinTxToBeInMempool, waitForBitcoinMempoolToGetTxs } = require('../btc-utils');
const { decodeOutpointValues } = require('../varint');
const { waitForHsmsToBeSynchedToThisBlock, HSM_DIFFICULTY_TARGET, isRunningHsms } = require('../federators-utils');
const rsk = require('peglib/rsk');

const parseBtcPublicKeys = (btcPublicKeysInString) => {
    const publicKeyLengthWithoutOxPrefix = 66;
    const btcPublicKeysStringWithout0x = removePrefix0x(btcPublicKeysInString);
    const btcPublicKeysInArray = splitStringIntoChunks(btcPublicKeysStringWithout0x, publicKeyLengthWithoutOxPrefix);
    const btcPublicKeysInArrayWith0xPrefix = btcPublicKeysInArray.map(key => ensure0x(key));
    return btcPublicKeysInArrayWith0xPrefix;
};

const importAccounts = async (rskTxHelper, privateKeys) => {
    const importedAddresses = [];
    for (const privateKey of privateKeys) {
        const address = await rskTxHelper.importAccount(privateKey);
        importedAddresses.push(address);
    }
    return importedAddresses;
};

const execute = (description, newFederationConfig, segwitToSegwitFederationChange = false) => {

    let rskTxHelpers;
    let rskTxHelper;
    let bridge;
    let bridgeTxParser;

    const regtestFedChangeAuthorizer1PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[0];
    const regtestFedChangeAuthorizer2PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[1];
    const regtestFedChangeAuthorizer3PrivateKey = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS[2];

    // Used the same variable names as the seeds.
    const notAuthorized1PrivateKey = 'bb7a53f495b863a007a3b1e28d2da2a5ec0343976a9be64e6fcfb97791b0112b';
    const notAuthorized2PrivateKey = '80808cf8ca7ebb986945b4d3bd7cf8e4b05c35f6f8796bd412a80997ef7895e6';
    const notAuthorized3PrivateKey = '8a7d07ad23a412558259e3857214d7b521589d0b37509839d7591e6f4026b4df';

    const EXPECTED_UNSUCCESSFUL_RESULT = '-10';
    const PENDING_FEDERATION_ALREADY_EXISTS_ERROR_CODE = '-1';
    const PROPOSED_FEDERATION_ALREADY_EXISTS_ERROR_CODE = '-4';
    const EXISTING_FEDERATION_AWAITING_ACTIVATION_ERROR_CODE = '-2';
    const RETIRING_FEDERATION_ALREADY_EXISTS = '-3';

    let fedChangeAuthorizer1Address;
    let fedChangeAuthorizer2Address;
    let fedChangeAuthorizer3Address;
    let initialFederationPublicKeys;
    let newFederationBtcPublicKeys;
    let commitFederationEvent;
    let expectedNewFederationAddress;
    let commitFederationCreationBlockNumber;
    let expectedNewFederationErpRedeemScript;
    let newFederationPublicKeys;
    let btcTxHelper;
    let minimumPeginValueInSatoshis;
    let expectedFlyoverAddress;
    let svpSpendBtcTransaction;
    let proposedFederationInfo;
    let initialActiveFederationInfo;
    let notAuthorized1Address;
    let notAuthorized2Address;
    let notAuthorized3Address;

    describe(description, async function() {
    
        before(async () => {

            rskTxHelper = getRskTransactionHelper();
            await startNewFederationNodes(newFederationConfig.members, rskTxHelper);

            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            bridgeTxParser = new BridgeTransactionParser(rskTxHelper.getClient());
            btcTxHelper = getBtcClient();
            
            await fundNewFederators(rskTxHelper, newFederationConfig.members);

            console.log('Synching federators...');
            await rskUtils.waitForSync(rskTxHelpers);
            console.log('Federators synced!');

            // Import the private keys of the federation change authorizers.

            const importedFederationChangeAuthorizers = await importAccounts(rskTxHelper, [regtestFedChangeAuthorizer1PrivateKey, regtestFedChangeAuthorizer2PrivateKey, regtestFedChangeAuthorizer3PrivateKey]);

            fedChangeAuthorizer1Address = importedFederationChangeAuthorizers[0];
            fedChangeAuthorizer2Address = importedFederationChangeAuthorizers[1];
            fedChangeAuthorizer3Address = importedFederationChangeAuthorizers[2];

            // Send some funds to the federation change authorizers to pay for transaction fees while voting.
            await rskUtils.sendFromCow(rskTxHelper, fedChangeAuthorizer1Address, btcToWeis(0.1));
            await rskUtils.sendFromCow(rskTxHelper, fedChangeAuthorizer2Address, btcToWeis(0.1));
            await rskUtils.sendFromCow(rskTxHelper, fedChangeAuthorizer3Address, btcToWeis(0.1));

            // Import the private keys of the not authorized addresses.

            const importedNotAuthorizedAddresses = await importAccounts(rskTxHelper, [notAuthorized1PrivateKey, notAuthorized2PrivateKey, notAuthorized3PrivateKey]);

            notAuthorized1Address = importedNotAuthorizedAddresses[0];
            notAuthorized2Address = importedNotAuthorizedAddresses[1];
            notAuthorized3Address = importedNotAuthorizedAddresses[2];

            // Sending some funds to the not authorized addresses to pay for transaction fees while voting.
            // This is done to realistically test the federation change process, so it doesn't fail by something else like insufficient funds.
            await rskUtils.sendFromCow(rskTxHelper, notAuthorized1Address, btcToWeis(0.1));
            await rskUtils.sendFromCow(rskTxHelper, notAuthorized2Address, btcToWeis(0.1));
            await rskUtils.sendFromCow(rskTxHelper, notAuthorized3Address, btcToWeis(0.1));

            bridge = await getBridge(rskTxHelper.getClient());

            initialFederationPublicKeys = await getActiveFederationPublicKeys(bridge);
            newFederationPublicKeys = getNewFederationPublicKeysFromNewFederationConfig(newFederationConfig);

            newFederationBtcPublicKeys = newFederationPublicKeys.map(federator => federator[KEY_TYPE_BTC]);

            const expectedNewFederationErpRedeemScriptBuffer = redeemScriptParser.getP2shErpRedeemScript(newFederationBtcPublicKeys.map(key => removePrefix0x(key)), ERP_PUBKEYS, ERP_CSV_VALUE);
            expectedNewFederationErpRedeemScript = expectedNewFederationErpRedeemScriptBuffer.toString('hex');
            
            expectedNewFederationAddress = redeemScriptParser.getP2shP2wshAddressFromRedeemScript('REGTEST', expectedNewFederationErpRedeemScriptBuffer);

            const flyoverNewFederationRedeemScript = redeemScriptParser.getFlyoverRedeemScript(expectedNewFederationErpRedeemScriptBuffer, FLYOVER_DERIVATION_HASH);

            expectedFlyoverAddress = redeemScriptParser.getP2shP2wshAddressFromRedeemScript('REGTEST', flyoverNewFederationRedeemScript);

            initialActiveFederationInfo = await getActiveFederationInfo(bridge);

            await btcTxHelper.importAddress(initialActiveFederationInfo.address, 'federations');
            await btcTxHelper.importAddress(expectedNewFederationAddress, 'federations');

            minimumPeginValueInSatoshis = Number(await bridge.methods.getMinimumLockTxValue().call());

            const bridgeState = await getBridgeState(rskTxHelper.getClient());

            if(bridgeState.activeFederationUtxos.length === 0) {
                // Making donation pegins to ensure there are enough utxos to test the migration step.
                const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'legacy', satoshisToBtc(minimumPeginValueInSatoshis) * 4);
                await sendPeginToActiveFederation(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(minimumPeginValueInSatoshis));
                await sendPeginToActiveFederation(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(minimumPeginValueInSatoshis + 1000));
                const btcPeginTxHash = await sendPeginToActiveFederation(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(minimumPeginValueInSatoshis + 2000));
                await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
            }

        });

        it('should not be able to call `createFederation` without authorization', async () => {
            
            // Ensuring no pending federation exists yet.
            const pendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());
            const expectedPendingFederationSize = -1;
            expect(pendingFederationSize).to.be.equal(expectedPendingFederationSize, 'No pending federation should exist yet.');

            const createFederationMethod = await bridge.methods.createFederation();

            const message = 'The `createFederation` method should not be callable by an unauthorized address.';

            // First unauthorized create federation call
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, notAuthorized1Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            // Second unauthorized create federation call
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, notAuthorized2Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            // Third unauthorized create federation call
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, notAuthorized3Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            const actualPendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());

            const expectedFederationSize = -1;

            expect(actualPendingFederationSize).to.be.equal(expectedFederationSize, 'A pending federation should not be created if the method is called by unauthorized addresses.');

        });

        it('should create a pending federation, add keys and mine blocks to pass the validation period and revert', async () => {

            await createPendingFederation();
            await addFederatorsPublicKeys();
            await commitThePendingFederationAndCheckProposedFederationIsCreated();

            await rskUtils.mineAndSync(rskTxHelpers, VALIDATION_PERIOD_DURATION_IN_BLOCKS + 1);

            await rskUtils.waitAndUpdateBridge(rskTxHelper);

            const latestBlockNumber = await rskTxHelper.getBlockNumber();

            const commitFederationEvent = await rskUtils.findEventInBlock(rskTxHelper, FEDERATION_EVENTS.COMMIT_FEDERATION_FAILED.name, latestBlockNumber);

            const proposedFederationRedeemScript = removePrefix0x(commitFederationEvent.arguments.proposedFederationRedeemScript);

            expect(proposedFederationRedeemScript).to.be.equal(expectedNewFederationErpRedeemScript, 'The failed proposed federation redeem script should be the same as the expected one.');
            
            const blockNumber = Number(commitFederationEvent.arguments.blockNumber);
            expect(blockNumber).to.be.equal(latestBlockNumber, 'The block number of the commit federation event should be the same as the latest block number.');
            
            const pendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());
            const expectedPendingFederationSize = -1;
            expect(pendingFederationSize).to.be.equal(expectedPendingFederationSize, 'The pending federation should be reverted after the validation period.');

            const pendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(pendingFederationHash).to.be.equal(null, 'The pending federation hash should be null after the validation period.');

            const activeFederationAddress = await bridge.methods.getFederationAddress().call();

            expect(activeFederationAddress).to.be.equal(initialActiveFederationInfo.address, 'The active federation address should be the same as the initial one.');

            await assertProposedFederationIsNotInStorage(bridge);

            proposedFederationInfo = null;
            
        });

        it('should create a pending federation', async () => {
            await createPendingFederation();
        });

        it('should add federators public keys', async () => {
            await addFederatorsPublicKeys();
        });

        it('should not create a new pending federation when there is one already created', async () => {

            const initialPendingFederationHash = await bridge.methods.getPendingFederationHash().call();

            const createFederationMethod = await bridge.methods.createFederation();

            const message = 'The `createFederation` method should not be callable when there is a pending federation.';

            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer1Address, result => {
                expect(result).to.be.equal(PENDING_FEDERATION_ALREADY_EXISTS_ERROR_CODE, message);
            });
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer2Address, result => {
                expect(result).to.be.equal(PENDING_FEDERATION_ALREADY_EXISTS_ERROR_CODE, message);
            });
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer3Address, result => {
                expect(result).to.be.equal(PENDING_FEDERATION_ALREADY_EXISTS_ERROR_CODE, message);
            });

            const finalPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(initialPendingFederationHash).to.be.equal(finalPendingFederationHash, 'The pending federation hash should not change when calling `createFederation` if there is a pending federation already.');

        });

        it('should not be able to call `addFederatorPublicKeyMultikey` without authorization', async () => {

            const initialPendingFederationHash = await bridge.methods.getPendingFederationHash().call();

            const randomFedPublicKey = '0x03445e8ead0cd796cec8204f1ce43c353062280dacd77b2a703b4ff5df17729767';

            const addFederatorPublicKeyMultikeyMethod = bridge.methods.addFederatorPublicKeyMultikey(
                randomFedPublicKey,
                randomFedPublicKey,
                randomFedPublicKey
            );

            const message = 'The `addFederatorPublicKeyMultikey` method should not be callable by an unauthorized address.';

            // First unauthorized add federator public key call
            await rskUtils.sendTxWithCheck(rskTxHelper, addFederatorPublicKeyMultikeyMethod, notAuthorized1Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            // Second unauthorized add federator public key call
            await rskUtils.sendTxWithCheck(rskTxHelper, addFederatorPublicKeyMultikeyMethod, notAuthorized2Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            // Third unauthorized add federator public key call
            await rskUtils.sendTxWithCheck(rskTxHelper, addFederatorPublicKeyMultikeyMethod, notAuthorized3Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            const finalPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(initialPendingFederationHash).to.be.equal(finalPendingFederationHash, 'The pending federation hash should not change if the method is called by unauthorized addresses.');

        });

        it('should not be able to call `commitFederation` without authorization', async () => {
            const pendingFederationHash = await bridge.methods.getPendingFederationHash().call();

            const commitFederationMethod = await bridge.methods.commitFederation(pendingFederationHash);

            const message = 'The `commitFederation` method should not be callable by an unauthorized address.';

            // First unauthorized commit federation call
            await rskUtils.sendTxWithCheck(rskTxHelper, commitFederationMethod, notAuthorized1Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            // Second unauthorized commit federation call
            await rskUtils.sendTxWithCheck(rskTxHelper, commitFederationMethod, notAuthorized2Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            // Third unauthorized commit federation call
            const commitFederationTransactionReceipt = await rskUtils.sendTxWithCheck(rskTxHelper, commitFederationMethod, notAuthorized3Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            const bridgeTransaction = await bridgeTxParser.getBridgeTransactionByTxHash(commitFederationTransactionReceipt.transactionHash);

            const foundCommitFederationEvent = bridgeTransaction.events.some(event => event.name === 'commit_federation');

            expect(foundCommitFederationEvent, 'The commit federation event should not be emitted.').to.be.false;

            const finalPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(pendingFederationHash).to.be.equal(finalPendingFederationHash, 'The pending federation hash should not change if the method is called by unauthorized addresses.');
        });

        it('should not be able to call `rollbackFederation` without authorization', async () => {

            const pendingFederationHash = await bridge.methods.getPendingFederationHash().call();

            const rollbackFederationMethod = await bridge.methods.rollbackFederation();

            const message = 'The `rollbackFederation` method should not be callable by an unauthorized address.';

            // First unauthorized rollback federation call
            await rskUtils.sendTxWithCheck(rskTxHelper, rollbackFederationMethod, notAuthorized1Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            // Second unauthorized rollback federation call
            await rskUtils.sendTxWithCheck(rskTxHelper, rollbackFederationMethod, notAuthorized2Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            // Third unauthorized rollback federation call
            await rskUtils.sendTxWithCheck(rskTxHelper, rollbackFederationMethod, notAuthorized3Address, result => {
                expect(result).to.be.equal(EXPECTED_UNSUCCESSFUL_RESULT, message);
            });

            const finalPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(pendingFederationHash).to.be.equal(finalPendingFederationHash, 'The pending federation hash should not change if the method is called by unauthorized addresses.');

        });

        it('should commit the pending federation and create the proposed federation', async () => {

            await commitThePendingFederationAndCheckProposedFederationIsCreated();

        });

        it('should not create a new pending federation when there is a proposed federation', async () => {

            const initialPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(initialPendingFederationHash, 'The pending federation hash should be null.').to.be.null;

            const createFederationMethod = await bridge.methods.createFederation();

            const message = 'The `createFederation` method should not be callable when there is a proposed federation.';

            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer1Address, result => {
                expect(result).to.be.equal(PROPOSED_FEDERATION_ALREADY_EXISTS_ERROR_CODE, message);
            });
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer2Address, result => {
                expect(result).to.be.equal(PROPOSED_FEDERATION_ALREADY_EXISTS_ERROR_CODE, message);
            });
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer3Address, result => {
                expect(result).to.be.equal(PROPOSED_FEDERATION_ALREADY_EXISTS_ERROR_CODE, message);
            });

            const finalPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(finalPendingFederationHash, 'The pending federation hash should be null.').to.be.null;
            
        });
    
        it('should not have created svp fund transaction and there should not be any SVP values in storage yet', async function () {

            const bridgeState = await getBridgeState(rskTxHelper.getClient());
    
            expect(bridgeState.pegoutsWaitingForConfirmations.length).to.be.equal(0, 'No pegout should be waiting for confirmations.');
            expect(bridgeState.pegoutsWaitingForSignatures.length).to.be.equal(0, 'No pegout should be waiting for signatures.');
    
            await assertSvpValuesNotPresentInStorage(rskTxHelper);
    
        });
    
        it('should create the SVP Fund transaction on the next updateCollections call', async function () {
    
            // Act
    
            const initialBridgeState = await getBridgeState(rskTxHelper.getClient());
    
            await rskUtils.waitAndUpdateBridge(rskTxHelper);
    
            const finalBridgeState = await getBridgeState(rskTxHelper.getClient());
    
            // Assert
    
            // The SVP fund transaction should be created and put in waiting for confirmations.

            expect(finalBridgeState.pegoutsWaitingForConfirmations.length).to.be.equal(1, 'There should be one pegout waiting for confirmations.');
            expect(finalBridgeState.pegoutsWaitingForSignatures.length).to.be.equal(0, 'No pegout should be waiting for signatures.');
    
            const svpFundTxWaitingForConfirmations = finalBridgeState.pegoutsWaitingForConfirmations[0];
    
            const pegoutCreationBlockNumber = Number(svpFundTxWaitingForConfirmations.pegoutCreationBlockNumber);
    
            const expectedPegoutCreationBlockNumber = commitFederationCreationBlockNumber + 4; // + 4 because a previous test mines 3 blocks, plus 1 for the expected pegout creation block number to be the next block.
            expect(pegoutCreationBlockNumber).to.be.equal(expectedPegoutCreationBlockNumber, 'The svp fund tx pegout creation block number should be the block that contains the first updateCollections call right after the commitFederation call.');
    
            const rawSvpFundTransaction = svpFundTxWaitingForConfirmations.btcRawTx;
    
            const svpFundTransaction = bitcoinJsLib.Transaction.fromHex(rawSvpFundTransaction);

            if(!segwitToSegwitFederationChange) {
                svpFundTransaction.ins.forEach(input => {
                    expect(input.witness.length).to.be.equal(0, 'The SVP fund transaction inputs should not have witness data when there has not been a previous p2sh to p2wsh federation change.');
                });
            }  else if(segwitToSegwitFederationChange) {
                svpFundTransaction.ins.forEach(input => {
                    expect(input.witness.length).to.be.greaterThan(0, 'The SVP fund transaction inputs should have witness data when there has been a previous p2sh to p2wsh federation change.');
                });
            }
    
            expect(svpFundTransaction.outs.length).to.be.equal(3, 'The SVP fund transaction should have 3 outputs.');
    
            const proposedFederationAddress = await bridge.methods.getProposedFederationAddress().call();
    
            // The output addresses should be in the expected order.
            const proposedFederationOutput = svpFundTransaction.outs[0];
            const proposedFederationFlyoverOutput = svpFundTransaction.outs[1];
            const activeFederationOutput = svpFundTransaction.outs[2];
    
            const proposedFederationAddressFromOutputScript = bitcoinJsLib.address.fromOutputScript(proposedFederationOutput.script, btcTxHelper.btcConfig.network);
            expect(proposedFederationAddressFromOutputScript).to.be.equal(proposedFederationAddress, 'The proposed federation address in the SVP fund transaction should be the first output.');
    
            const actualProposedFederationFlyoverAddress = bitcoinJsLib.address.fromOutputScript(proposedFederationFlyoverOutput.script, btcTxHelper.btcConfig.network);
            expect(actualProposedFederationFlyoverAddress).to.be.equal(expectedFlyoverAddress, 'The flyover address in the SVP fund transaction should be the second expected output.');
    
            const actualActiveFederationAddress = bitcoinJsLib.address.fromOutputScript(activeFederationOutput.script, btcTxHelper.btcConfig.network);
            expect(actualActiveFederationAddress).to.be.equal(initialActiveFederationInfo.address, 'The active federation address in the SVP fund transaction should be the last output.');
    
            // The proposed federation and flyover addresses output values should be double the minimum pegout value.
            const expectedProposedFederationOutputValue = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS * 2;
            expect(proposedFederationOutput.value).to.be.equal(expectedProposedFederationOutputValue, 'The proposed federation output value should be double the minimum pegout value.');
    
            const expectedFlyoverOutputValue = MINIMUM_PEGOUT_AMOUNT_IN_SATOSHIS * 2;
            expect(proposedFederationFlyoverOutput.value).to.be.equal(expectedFlyoverOutputValue, 'The flyover output value should be double the minimum pegout value.');

            // Only the svp fund tx hash unsigned value should be in storage
            await assertOnlySvpFundTxHashUnsignedIsInStorage(rskTxHelper, svpFundTransaction.getId());
    
            // The release_requested event should be emitted with the expected values
            const releaseRequestedEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_REQUESTED.name, expectedPegoutCreationBlockNumber);
            const expectedReleaseRequestedAmount = expectedProposedFederationOutputValue + expectedFlyoverOutputValue;
            expect(Number(releaseRequestedEvent.arguments.amount)).to.be.equal(expectedReleaseRequestedAmount, 'The amount in the release requested event should be the sum of the proposed federation and flyover output values.');
            expect(releaseRequestedEvent, 'The release requested event should be emitted.').to.not.be.null;
            expect(removePrefix0x(releaseRequestedEvent.arguments.btcTxHash)).to.be.equal(svpFundTransaction.getId(), 'The btc tx hash in the release requested event should be the tx id of the SVP fund tx.');
            
            // The pegout_transaction_created event should be emitted with the expected values
            const pegoutTransactionCreatedEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.PEGOUT_TRANSACTION_CREATED.name, expectedPegoutCreationBlockNumber);
            expect(pegoutTransactionCreatedEvent, 'The pegout transaction created event should be emitted.').to.not.be.null;
            expect(removePrefix0x(pegoutTransactionCreatedEvent.arguments.btcTxHash)).to.be.equal(svpFundTransaction.getId(), 'The btc tx hash in the pegout transaction created event should be the tx id of the SVP fund tx.');
            
            await assertPegoutTransactionCreatedOutpointValues(initialBridgeState, finalBridgeState, svpFundTransaction, pegoutTransactionCreatedEvent);
    
        });

        it('should release and register the svp fund transaction and create the svp spend transaction', async function () {

            // Mining to have enough confirmations for the SVP fund transaction.
            await rskUtils.mineAndSync(rskTxHelpers, BTC_TO_RSK_MINIMUM_CONFIRMATIONS);

            const blockNumberBeforeSvpFundTxMovedToWaitingForSignatures = await rskTxHelper.getBlockNumber();

            if(isRunningHsms()) {
                await rskUtils.mineAndSync(rskTxHelpers, HSM_DIFFICULTY_TARGET + 1);
                await waitForHsmsToBeSynchedToThisBlock(rskTxHelper, blockNumberBeforeSvpFundTxMovedToWaitingForSignatures);
            }

            await rskUtils.waitAndUpdateBridge(rskTxHelper);
    
            const expectedCountOfSignatures = Math.floor(initialFederationPublicKeys.length / 2) + 1;
            const expectedCountOfPegoutsWaitingForSignatures = 1;
            await processTxFromWaitingForSignaturesToRegistration(rskTxHelper, btcTxHelper, expectedCountOfSignatures, expectedCountOfPegoutsWaitingForSignatures);

            const blockNumberAfterRelease = await rskTxHelper.getBlockNumber();

            const releaseBtcEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_BTC.name, blockNumberBeforeSvpFundTxMovedToWaitingForSignatures, blockNumberAfterRelease);
            expect(releaseBtcEvent, 'The release btc event should be emitted.').to.not.be.null;
            
            const releaseBtcTransaction = bitcoinJsLib.Transaction.fromHex(removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction));
            const transactionId = releaseBtcTransaction.getId();

            const isBtcTxHashAlreadyProcessed = await bridge.methods.isBtcTxHashAlreadyProcessed(transactionId).call();

            expect(isBtcTxHashAlreadyProcessed, 'The SVP fund tx should be registered in the Bridge by now.').to.be.true;
    
            await assertOnlySvpSpendTxValuesAreInStorage(rskTxHelper);
    
            await assertProposedFederationIsStillInStorage(bridge, expectedNewFederationAddress, newFederationPublicKeys);
    
        });

        it('should register the SVP Spend transaction and finish the SVP process', async function () {

            // Mining `BTC_TO_RSK_MINIMUM_CONFIRMATIONS` blocks to ensure the SVP Spend transaction waiting for signatures has enough confirmations to be processed.
            await rskTxHelper.mine(BTC_TO_RSK_MINIMUM_CONFIRMATIONS);

            const blockNumberBeforeSvpSpendTxIsRegistered = await rskTxHelper.getBlockNumber();

            if(isRunningHsms()) {
                await rskUtils.mineAndSync(rskTxHelpers, HSM_DIFFICULTY_TARGET + 1);
                await waitForHsmsToBeSynchedToThisBlock(rskTxHelper, blockNumberBeforeSvpSpendTxIsRegistered);
            }

            const expectedCountOfSignatures = Math.floor(newFederationPublicKeys.length / 2) + 1;
            await processSvpSpendTxFromWaitingForSignaturesToRegistration(rskTxHelper, btcTxHelper, expectedCountOfSignatures);

            // Finding the SVP Spend transaction release_btc event
            const blockNumberAfterRegistration = await rskTxHelper.getBlockNumber();
            const releaseBtcEvent = await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_BTC.name, blockNumberBeforeSvpSpendTxIsRegistered, blockNumberAfterRegistration);

            svpSpendBtcTransaction = bitcoinJsLib.Transaction.fromHex(removePrefix0x(releaseBtcEvent.arguments.btcRawTransaction));

            svpSpendBtcTransaction.ins.forEach(input => {
                expect(input.witness.length).to.be.greaterThan(0, 'The SVP Spend transaction inputs should have witness data.');
            });

            // Mining the SVP Spend transaction in bitcoin to register it in the Bridge
            await waitForBitcoinTxToBeInMempool(btcTxHelper, svpSpendBtcTransaction.getId());
            await btcTxHelper.mine(BTC_TO_RSK_MINIMUM_CONFIRMATIONS);

            // Even though a proposed federator cannot call `updateCollections`, inside the powpeg `updateBridge` there are 4 calls to the Bridge.
            // One of them is `registerBtcTransaction`. The last one is `updateCollections`. Since the active federation's federators don't recognize the spend svp tx
            // as a valid btc tx to send to the Bridge, they will not send it. But the proposed federation's federators will send it.
            // This is why we are calling that `updateBridge` method with a proposed federator, so `registerBtcTransaction` gets called, and then we can call `updateCollections` latest with an active federation's federator.
            const proposedFedRskTxHelper = rskTxHelpers[rskTxHelpers.length - 1];
            const shouldMineAndSync = false; // We will mine and sync in the next `waitAndUpdateBridge` call.
            await rskUtils.waitAndUpdateBridge(proposedFedRskTxHelper, 1000, shouldMineAndSync);

            // Now calling `updateCollections` with a federator from the active federation to really call `updateCollections`.
            await rskUtils.waitAndUpdateBridge(rskTxHelper);

            const destinationAddress = bitcoinJsLib.address.fromOutputScript(svpSpendBtcTransaction.outs[0].script, btcTxHelper.btcConfig.network);
            expect(destinationAddress).to.be.equal(initialActiveFederationInfo.address, 'The destination address in the SVP Spend transaction should be the active federation address.');

            const svpSpendTxRegistered = await bridge.methods.isBtcTxHashAlreadyProcessed(svpSpendBtcTransaction.getId()).call();
            expect(svpSpendTxRegistered, 'The SVP Spend transaction should be registered in the Bridge by now.').to.be.true;

            await rskUtils.waitAndUpdateBridge(rskTxHelper);

            await assertProposedFederationIsNotInStorage(bridge);
    
            await assertSvpValuesNotPresentInStorage(rskTxHelper);

        });

        it('should not create a new pending federation when there is a federation waiting for activation', async () => {

            const initialPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(initialPendingFederationHash, 'The pending federation hash should be null.').to.be.null;

            const createFederationMethod = await bridge.methods.createFederation();

            const message = 'The `createFederation` method should not be callable when there is a federation waiting for activation.';

            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer1Address, result => {
                expect(result).to.be.equal(EXISTING_FEDERATION_AWAITING_ACTIVATION_ERROR_CODE, message);
            });
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer2Address, result => {
                expect(result).to.be.equal(EXISTING_FEDERATION_AWAITING_ACTIVATION_ERROR_CODE, message);
            });
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer3Address, result => {
                expect(result).to.be.equal(EXISTING_FEDERATION_AWAITING_ACTIVATION_ERROR_CODE, message);
            });

            const finalPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(finalPendingFederationHash, 'The pending federation hash should be null.').to.be.null;
            
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

            const activeFederationAddressInfo = await getActiveFederationInfo(bridge);

            expect(activeFederationAddressInfo.address).to.be.equal(expectedNewFederationAddress, 'The new active federation address should be the expected one.');
            expect(activeFederationAddressInfo.creationBlockNumber).to.be.equal(commitFederationCreationBlockNumber, 'The new active federation creation block number should be the expected one.');
            expect(activeFederationAddressInfo.size).to.be.equal(newFederationPublicKeys.length, 'The new active federation size should be the expected one.');
            
            expect(activeFederationAddressInfo.creationTime).to.be.equal(proposedFederationInfo.creationTime, 'The new active federation creation time should be the same as the proposed federation creation time.');

            const retiringFederationSize = Number(await bridge.methods.getRetiringFederationSize().call());
            expect(retiringFederationSize).to.be.equal(initialFederationPublicKeys.length, 'The retiring federation size should be the same as the initial federation size.');

            const retiringFederationAddress = await bridge.methods.getRetiringFederationAddress().call();
            expect(retiringFederationAddress).to.be.equal(initialActiveFederationInfo.address, 'The retiring federation address should be the initial federation address.');

            const retiringFederationInformation = await getRetiringFederationInfo(bridge);

            expect(retiringFederationInformation.address).to.be.equal(initialActiveFederationInfo.address, 'The retiring federation address should be the initial federation address.');
            expect(retiringFederationInformation.creationBlockNumber).to.be.equal(initialActiveFederationInfo.creationBlockNumber, 'The retiring federation creation block number should be the same as the active federation creation block number.');
            expect(retiringFederationInformation.creationTime).to.be.equal(initialActiveFederationInfo.creationTime, 'The retiring federation creation time should be the same as the initial federation creation time.');
            expect(retiringFederationInformation.size).to.be.equal(initialFederationPublicKeys.length, 'The retiring federation size should be the same as the initial federation size.');

            const retiringFederationPublicKeys = await getRetiringFederationPublicKeys(bridge);
            expect(retiringFederationPublicKeys).to.be.deep.equal(initialFederationPublicKeys, 'The retiring federation public keys should be the same as the initial federation public keys.');

        });

        it('should do a pegin with the retiring federation', async () => {
            const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
            const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'legacy', satoshisToBtc(minimumPeginValueInSatoshis) * 2);
            const btcPeginTxHash = await sendPeginToRetiringFederation(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(minimumPeginValueInSatoshis));
            await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
            await assert2wpBalancesAfterSuccessfulPegin(rskTxHelper, btcTxHelper, initial2wpBalances, minimumPeginValueInSatoshis);
            const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
            const expectedRskRecipientBalancesInWeisBN = new BN(satoshisToWeis(minimumPeginValueInSatoshis));
            expect(finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)).to.be.true;
        });

        it('should do a pegin with the new federation', async () => {
            const rskTxHelper = rskTxHelpers[rskTxHelpers.length - 1];
            const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
            const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'legacy', satoshisToBtc(minimumPeginValueInSatoshis) * 2);
            const btcPeginTxHash = await sendPeginToActiveFederation(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, satoshisToBtc(minimumPeginValueInSatoshis));
            await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash);
            await assert2wpBalancesAfterSuccessfulPegin(rskTxHelper, btcTxHelper, initial2wpBalances, minimumPeginValueInSatoshis);
            const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
            const expectedRskRecipientBalancesInWeisBN = new BN(satoshisToWeis(minimumPeginValueInSatoshis));
            expect(finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)).to.be.true;
        });

        it('should do a pegin with outputs to both active and retiring federations', async () => {
            const initial2wpBalances = await get2wpBalances(rskTxHelper, btcTxHelper);
            const senderRecipientInfo = await createSenderRecipientInfo(rskTxHelper, btcTxHelper, 'legacy', satoshisToBtc(minimumPeginValueInSatoshis) * 3);
            const peginAmountForActiveFederation = satoshisToBtc(minimumPeginValueInSatoshis);
            const peginAmountForRetiringFederation = satoshisToBtc(minimumPeginValueInSatoshis);
            const btcPeginTxHash = await sendPeginToActiveAndRetiringFederations(rskTxHelper, btcTxHelper, senderRecipientInfo.btcSenderAddressInfo, peginAmountForActiveFederation, peginAmountForRetiringFederation);
            const expectedCountOfUtxos = 2;
            await ensurePeginIsRegistered(rskTxHelper, btcPeginTxHash, expectedCountOfUtxos);
            const totalPeginAmountInSatoshis = minimumPeginValueInSatoshis * 2;
            await assert2wpBalancesAfterSuccessfulPegin(rskTxHelper, btcTxHelper, initial2wpBalances, totalPeginAmountInSatoshis);
            const finalRskRecipientBalanceInWeisBN = await rskTxHelper.getBalance(senderRecipientInfo.rskRecipientRskAddressInfo.address);
            const expectedRskRecipientBalancesInWeisBN = new BN(satoshisToWeis(totalPeginAmountInSatoshis));
            expect(finalRskRecipientBalanceInWeisBN.eq(expectedRskRecipientBalancesInWeisBN)).to.be.true;
        });

        it('should migrate utxos', async () => {

            const bridgeStateBeforeMigration = await getBridgeState(rskTxHelper.getClient());
            
            expect(bridgeStateBeforeMigration.pegoutsWaitingForConfirmations.length).to.be.equal(0, 'No pegout should be waiting for confirmations.');
            expect(bridgeStateBeforeMigration.pegoutsWaitingForSignatures.length).to.be.equal(0, 'No pegout should be waiting for signatures.');
            
            const oldUtxosRlpEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, oldFederationBtcUTXOSStorageIndex);
            const oldFederationUtxos = parseRLPToActiveFederationUtxos(oldUtxosRlpEncoded);

            // Mining to activate the migration age
            await rskUtils.mineAndSync(rskTxHelpers, FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_BEGIN + 1);

            // Start migration
            await rskUtils.waitAndUpdateBridge(rskTxHelper);
            const bridgeStateAfterUpdatingCollections = await getBridgeState(rskTxHelper.getClient());

            expect(bridgeStateAfterUpdatingCollections.pegoutsWaitingForConfirmations.length).to.be.greaterThan(0, 'There should be at least one pegout waiting for confirmations.');
    
            await wait(1000);
            await rskUtils.mineAndSync(rskTxHelpers, BTC_TO_RSK_MINIMUM_CONFIRMATIONS);
            const blockNumberAfterConfirmations = await rskTxHelper.getBlockNumber();

             if(isRunningHsms()) {
                await rskUtils.mineAndSync(rskTxHelpers, HSM_DIFFICULTY_TARGET + 1);
                await waitForHsmsToBeSynchedToThisBlock(rskTxHelper, blockNumberAfterConfirmations);
             }

            await wait(1000);
            await rskUtils.waitAndUpdateBridge(rskTxHelper);
            const lastFederator = rskTxHelpers[rskTxHelpers.length - 1];
            await rskUtils.waitAndUpdateBridge(lastFederator);
            
            const blockNumberBeforeMigrationRelease = await rskTxHelper.getBlockNumber();

            const checkPegoutIsBroadcasted = async () => {
                const currentBridgeState = await getBridgeState(rskTxHelper.getClient());
                if(currentBridgeState.pegoutsWaitingForSignatures.length === 0 && currentBridgeState.pegoutsWaitingForConfirmations.length === 0) {
                  return true;
                }
                await wait(1000);
                await rskUtils.waitAndUpdateBridge(rskTxHelpers[rskTxHelpers.length - 1]);
                return false;
            };
              
            await retryWithCheck(checkPegoutIsBroadcasted, pegoutIsBroadcasted => pegoutIsBroadcasted);

            const bridgeStateAfterMiningPegout = await getBridgeState(rskTxHelper.getClient());

            expect(bridgeStateAfterMiningPegout.pegoutsWaitingForConfirmations.length).to.be.equal(0, 'No pegout should be waiting for confirmations.');
            expect(bridgeStateAfterMiningPegout.pegoutsWaitingForSignatures.length).to.be.equal(0, 'No pegout should be waiting for signatures.');
    
            // Finding the migration transaction release_btc event
            const blockNumberAfterRelease = await rskTxHelper.getBlockNumber();

            const releaseBtcEvents = [];

            await rskUtils.findEventInBlock(rskTxHelper, PEGOUT_EVENTS.RELEASE_BTC.name, blockNumberBeforeMigrationRelease, blockNumberAfterRelease, foundEvent => {
                releaseBtcEvents.push(foundEvent);
            });

            const allMigrationBtcTransactions = releaseBtcEvents.map(event => bitcoinJsLib.Transaction.fromHex(removePrefix0x(event.arguments.btcRawTransaction)));

            const allMigrationInputs = allMigrationBtcTransactions.map(tx => tx.ins).flat();

            const migrationReleaseBtcTransactionInputHashes = allMigrationInputs.map(input => Buffer.from(input.hash).reverse().toString('hex')).sort();
            const oldFederationUtxosHashes = oldFederationUtxos.map(utxo => utxo.btcTxHash).sort();

            const allMigrationOutputs = allMigrationBtcTransactions.map(tx => tx.outs).flat();

            expect(migrationReleaseBtcTransactionInputHashes).to.be.deep.equal(oldFederationUtxosHashes, 'The migration transaction inputs should be the same as the active federation utxos before activation.');

            for(const migrationOutput of allMigrationOutputs) {
                const destinationAddress = bitcoinJsLib.address.fromOutputScript(migrationOutput.script, btcTxHelper.btcConfig.network);
                expect(destinationAddress).to.be.equal(expectedNewFederationAddress, 'The destination address of the migration transaction should be the new federation address.');
            }

            await wait(1000);
            await btcTxHelper.mine(BTC_TO_RSK_MINIMUM_CONFIRMATIONS);
            await rskUtils.waitAndUpdateBridge(rskTxHelper);
    
            const finalBridgeState = await getBridgeState(rskTxHelper.getClient());
 
            for(const migrationBtcTx of allMigrationBtcTransactions) {
                const migrationUtxo = finalBridgeState.activeFederationUtxos.find(utxo => utxo.btcTxHash === migrationBtcTx.getId());
                expect(migrationUtxo, 'The migration utxo should be registered in the Bridge by now.').to.not.be.undefined;
                expect(migrationUtxo.valueInSatoshis).to.be.equal(migrationBtcTx.outs[0].value, 'The migration output value should be the same as the migration utxo value.');
            }
    
        });

        it('should not create a new pending federation when there is a retiring federation', async () => {

            const initialPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(initialPendingFederationHash, 'The pending federation hash should be null.').to.be.null;

            const createFederationMethod = await bridge.methods.createFederation();

            const message = 'The `createFederation` method should not be callable when there is a retiring federation.';

            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer1Address, result => {
                expect(result).to.be.equal(RETIRING_FEDERATION_ALREADY_EXISTS, message);
            });
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer2Address, result => {
                expect(result).to.be.equal(RETIRING_FEDERATION_ALREADY_EXISTS, message);
            });
            await rskUtils.sendTxWithCheck(rskTxHelper, createFederationMethod, fedChangeAuthorizer3Address, result => {
                expect(result).to.be.equal(RETIRING_FEDERATION_ALREADY_EXISTS, message);
            });

            const finalPendingFederationHash = await bridge.methods.getPendingFederationHash().call();
            expect(finalPendingFederationHash, 'The pending federation hash should be null.').to.be.null;
            
        });

        it('should complete retiring the old federation', async () => {

            await rskUtils.waitForSync(rskTxHelpers);
            await stopPreviousFederators(newFederationConfig);
            
            // The old federates are no longer part of the new federation, so we need to recreate the following instances to exclude them.
            rskTxHelpers = getRskTransactionHelpers();
            rskTxHelper = rskTxHelpers[0];
            bridge = await getBridge(rskTxHelper.getClient());

            await importAccounts(rskTxHelper, [regtestFedChangeAuthorizer1PrivateKey, regtestFedChangeAuthorizer2PrivateKey, regtestFedChangeAuthorizer3PrivateKey]);
            await importAccounts(rskTxHelper, [notAuthorized1PrivateKey, notAuthorized2PrivateKey, notAuthorized3PrivateKey]);

            const blocksToMineToRetireFederation = FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END;
            // Mining enough blocks to complete retiring the old federation.
            await rskUtils.mineAndSync(rskTxHelpers, blocksToMineToRetireFederation);

            // Updating bridge since this is required for the retiring federation to be removed.
            await rskUtils.waitAndUpdateBridge(rskTxHelper);

            const retiringFederationInformation = await getRetiringFederationInfo(bridge);

            expect(retiringFederationInformation.size).to.be.equal(-1, 'The retiring federation size should be -1.');
            expect(retiringFederationInformation.address).to.be.equal('', 'The retiring federation address should be the initial federation address.');
            expect(retiringFederationInformation.creationBlockNumber).to.be.equal(-1, 'The retiring federation creation block number should be -1.');
            expect(retiringFederationInformation.creationTime).to.be.equal(-1, 'The retiring federation creation time should be -1.');
        
        });

        it('should create a pending federation and roll it back', async () => {
            
            await createPendingFederation();
            await rollbackFederation();

        });

        it('should create a pending federation, add federator public keys and roll it back', async () => {

            await createPendingFederation();
            await addFederatorsPublicKeys();
            await rollbackFederation();

        });

    });

    const createPendingFederation = async () => {

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
    
    };

    const addFederatorsPublicKeys = async () => {
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
    };

    const rollbackFederation = async () => {

        const rollbackFederationMethod = await bridge.methods.rollbackFederation();

        // First rollback federation vote
        await rskUtils.sendTransaction(rskTxHelper, rollbackFederationMethod, fedChangeAuthorizer1Address);

        // Second rollback federation vote
        await rskUtils.sendTransaction(rskTxHelper, rollbackFederationMethod, fedChangeAuthorizer2Address);

        // Third and final rollback federation vote
        await rskUtils.sendTransaction(rskTxHelper, rollbackFederationMethod, fedChangeAuthorizer3Address);

        const actualPendingFederationSize = Number(await bridge.methods.getPendingFederationSize().call());
        const expectedFederationSize = -1;
        expect(actualPendingFederationSize).to.be.equal(expectedFederationSize, 'The pending federation should not exist anymore.');

    };

    const commitThePendingFederationAndCheckProposedFederationIsCreated = async () => {

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
        expect(oldFederationAddress).to.be.equal(initialActiveFederationInfo.address, 'The old federation address in the commit_federation event should now be the same as the initial.');

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

        proposedFederationInfo = await getProposedFederationInfo(bridge);

        expect(proposedFederationInfo.size).to.be.equal(newFederationPublicKeys.length, 'The proposed federation size should be the expected one.');
        expect(proposedFederationInfo.address).to.be.equal(expectedNewFederationAddress, 'The proposed federation address should be the expected one.');
        expect(proposedFederationInfo.creationBlockNumber).to.be.equal(commitFederationCreationBlockNumber, 'The proposed federation creation block number should be the expected one.');
        
        const proposedFederationPublicKeys = await getProposedFederationPublicKeys(bridge);
        expect(proposedFederationPublicKeys).to.be.deep.equal(newFederationPublicKeys, 'The proposed federation public keys should be the expected ones.');

    };

};

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

const assertPegoutTransactionCreatedOutpointValues = async (initialBridgeState, finalBridgeState, svpFundTransaction, pegoutTransactionCreatedEvent) => {

    expect(svpFundTransaction.ins.length > 0).to.be.true;
    expect(svpFundTransaction.ins.length).to.be.at.most(initialBridgeState.activeFederationUtxos.length);
    
    const svpFundTxUtxosInInitialBridgeState = [];

    svpFundTransaction.ins.forEach((input, index) => {
        const inputTxHash = Buffer.from(input.hash).reverse().toString('hex');
        const inputIndex = input.index;
        const utxoInInitialBridgeState = initialBridgeState.activeFederationUtxos.find(utxo => utxo.btcTxHash === inputTxHash && utxo.btcTxOutputIndex === inputIndex);
        expect(utxoInInitialBridgeState, `The input tx hash ${inputTxHash} and index ${inputIndex} should be in the initial bridge state.`).to.not.be.undefined;
        svpFundTxUtxosInInitialBridgeState.push(utxoInInitialBridgeState);
        const utxoInFinalBridgeState = finalBridgeState.activeFederationUtxos.find(utxo => utxo.btcTxHash === inputTxHash && utxo.btcTxOutputIndex === inputIndex);
        expect(utxoInFinalBridgeState, `The input tx hash ${inputTxHash} and index ${inputIndex} should not be in the final bridge state.`).to.be.undefined;
    });

    const encodedUtxoOutpointValues = Buffer.from(removePrefix0x(pegoutTransactionCreatedEvent.arguments.utxoOutpointValues), 'hex');
    const outpointValues = decodeOutpointValues(encodedUtxoOutpointValues);
    expect(outpointValues.length > 0).to.be.true;
    const outpointsValueSum = outpointValues.reduce((acc, value) => acc + Number(value), 0);
    const svpFundTxUtxoInInitialBridgeStateValueSum = svpFundTxUtxosInInitialBridgeState.reduce((acc, utxo) => acc + utxo.valueInSatoshis, 0);
    expect(Number(outpointsValueSum)).to.be.equal(svpFundTxUtxoInInitialBridgeStateValueSum, 'The outpoint value should be the same as the sum of the utxos values used.');

};

const getDecodedSvpSpendTxWaitingForSignaturesFromStorage = async (rskTxHelper) => {

    const svpSpendTxWaitingForSignatures = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxWaitingForSignaturesStorageIndex);
    expect(svpSpendTxWaitingForSignatures).to.not.be.equal('0x0', 'The SVP spend tx waiting for signatures storage value should not be empty.');

    const decodedSvpSpendTxWaitingForSignatures = parseRLPToPegoutWaitingSignatures(svpSpendTxWaitingForSignatures)[0];
    const svpSpendBtcTx = bitcoinJsLib.Transaction.fromHex(removePrefix0x(decodedSvpSpendTxWaitingForSignatures.btcRawTx));
    
    return svpSpendBtcTx;

};

const assertOnlySvpSpendTxValuesAreInStorage = async (rskTxHelper) => {

    const svpFundTxHashUnsignedRlpEncoded = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpFundTxHashUnsignedStorageIndex);
    expect(svpFundTxHashUnsignedRlpEncoded).to.be.equal('0x0', 'The SVP fund tx hash unsigned storage value should be empty.');

    const svpFundTxSigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpFundTxSignedStorageIndex);
    expect(svpFundTxSigned).to.be.equal('0x0', 'The SVP fund tx signed storage value should be empty.');

    const svpSpendTxHashUnsigned = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxHashUnsignedStorageIndex);
    expect(svpSpendTxHashUnsigned).to.not.be.equal('0x0', 'The SVP spend tx hash unsigned storage value should not be empty.');
    const svpSpendTxHashUnsignedDecoded = decodeRlp(svpSpendTxHashUnsigned).toString('hex');

    const svpSpendBtcTx = await getDecodedSvpSpendTxWaitingForSignaturesFromStorage(rskTxHelper);
    expect(svpSpendTxHashUnsignedDecoded).to.be.equal(svpSpendBtcTx.getId(), 'The SVP spend tx hash unsigned storage value should be the tx id of the SVP spend tx.');

};

const assertProposedFederationIsStillInStorage = async (bridge, expectedProposedFederationAddress, expectedProposedFederationPublicKeys) => {

    const proposedFederationAddress = await bridge.methods.getProposedFederationAddress().call();
    expect(proposedFederationAddress).to.be.equal(expectedProposedFederationAddress, 'The proposed federation address should still be in storage.');

    const proposedFederationPublicKeys = await getProposedFederationPublicKeys(bridge);
    expect(proposedFederationPublicKeys).to.be.deep.equal(expectedProposedFederationPublicKeys, 'The proposed federation public keys should still be in storage.');

};

const assertProposedFederationIsNotInStorage = async (bridge) => {

    const proposedFederationAddress = await bridge.methods.getProposedFederationAddress().call();
    expect(proposedFederationAddress).to.be.equal('');

    const proposedFederationSize = Number(await bridge.methods.getProposedFederationSize().call());
    expect(proposedFederationSize).to.be.equal(-1);

    const proposedFederationMembers = await getProposedFederationPublicKeys(bridge);
    expect(proposedFederationMembers).to.be.empty;

};

const processTxWaitingForSignaturesToRegistration = async(rskTxHelper, btcTxHelper, expectedCountOfSignatures) => {

    await rskUtils.waitForRskMempoolToGetThisCountOfAddSignatureTxs(rskTxHelper, expectedCountOfSignatures);

    await rskTxHelper.mine();

    await waitForBitcoinMempoolToGetTxs(btcTxHelper);

    await btcTxHelper.mine(3);

    const shouldMine = false;
    await rskUtils.waitAndUpdateBridge(rskTxHelper, 1000, shouldMine);

    await rskUtils.waitForRskMempoolToGetThisCountOfRegisterBtcTx(rskTxHelper, 1);

    await rskTxHelper.mine();

};

const processSvpSpendTxFromWaitingForSignaturesToRegistration = async (rskTxHelper, btcTxHelper, expectedContOfSignatures) => {

    const svpSpendTxWaitingForSignatures = await rskTxHelper.getClient().rsk.getStorageBytesAt(BRIDGE_ADDRESS, svpSpendTxWaitingForSignaturesStorageIndex);
    expect(svpSpendTxWaitingForSignatures).to.not.be.equal('0x0', 'The SVP spend tx waiting for signatures storage value should not be empty.');

    await processTxWaitingForSignaturesToRegistration(rskTxHelper, btcTxHelper, expectedContOfSignatures);

}; 

const processTxFromWaitingForSignaturesToRegistration = async (rskTxHelper, btcTxHelper, expectedContOfSignatures, expectedNumberOfPegoutsWaitingForSignatures = 1) => {

    const bridgeState = await getBridgeState(rskTxHelper.getClient());

    expect(bridgeState.pegoutsWaitingForSignatures.length).to.be.equal(expectedNumberOfPegoutsWaitingForSignatures, `There should be ${expectedNumberOfPegoutsWaitingForSignatures} pegout(s) waiting for signatures.`);

    await processTxWaitingForSignaturesToRegistration(rskTxHelper, btcTxHelper, expectedContOfSignatures);

};

module.exports = {
    execute,
};
