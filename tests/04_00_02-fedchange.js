const expect = require('chai').expect
const BN = require('bn.js');
const { sequentialPromise, wait, randomElement, randomNElements, additionalFederationAddresses } = require('../lib/utils');
const CustomError = require('../lib/CustomError');
const peglib = require('peglib');
const redeemScriptParser = require('@rsksmart/powpeg-redeemscript-parser');
const { getBridgeState } = require('@rsksmart/bridge-state-data-parser');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const pegAssertions = require('../lib/assertions/2wp');
const whitelistingAssertionsLegacy = require('../lib/assertions/whitelisting-legacy');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const rskUtils = require('../lib/rsk-utils');
const { compareFederateKeys } = require('../lib/federation-utils');
const libUtils = require('../lib/utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const removePrefix0x = require("../lib/utils").removePrefix0x;
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { sendPegin, ensurePeginIsRegistered, disableWhitelisting } = require('../lib/2wp-utils');
const { 
    KEY_TYPE_BTC, 
    KEY_TYPE_RSK, 
    KEY_TYPE_MST, 
    ERP_PUBKEYS, 
    ERP_CSV_VALUE, 
    MAX_INPUTS_PER_MIGRATION_TRANSACTION,
    REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS,
    REGTEST_FEDERATION_CHANGE_ADDRESSES,
    FEDERATION_ACTIVATION_AGE
} = require('../lib/constants');

const OTHER_PKS = [
  '1722c8adb8a702553bb2b4fa7c8de97e0b572e13404a1263b5b31fead3d9784f',
  '88db6c4f8909018f1f1e30910131c857b595876133f119be55a9f51d71486380',
  '115602cdbe1a40b356043c1052d8fe8525b8f9e56edf1857802b80447e0f4f27',
  '63eff8110c0a7ed1e36b5a90d968c3b73893b2a466234de8a2734a916b541571',
];

const EXPECTED_OTHER_ADDRESSES = [
  'c7ef118da1adadd3fa5d6c4cfb48b91b6e1387e6',
  'd36e347a840991871a675e50037ef47e2e6dfee2',
  'a8f118e323147edf158352a3cc1954d34b267632',
  '1045dda4782de22afddf576b98a8f25d89c94a4f',
];

const NETWORK = bitcoin.networks.testnet;
const INITIAL_FEDERATOR_BALANCE_IN_BTC = 1;
const INITIAL_FEDERATION_SIZE = 3;

// generated from 'reg-other'
const FEDERATION_RANDOM_PUBLIC_KEY = '0x03e7b89185a7b98d589f87067efcd1311c1256ab49a480a821aa3dd758fe768af6';
const PENDING_FEDERATION_RANDOM_HASH = '0x27da3e662acf8862ba5c42fbdcc023c4f81355a1562fd07534ab588640d5eeab';

const INITIAL_BTC_BALANCE = bitcoin.btcToSatoshis(200);
const EXPECTED_UNSUCCESSFUL_RESULT = -10;

let btcClient;
let rskClientOldFed;
let rskClientNewFed;
let rskClients;
let pegClient;
let test;
let testNewFed;
let utils;
let expectedNewFederationCreationTime, expectedNewFederationCreationBlockNumber;
let oldFederation;
let newFederationBtcPublicKeys;
let newFederationPublicKeys;
let newFederatorRskAddressesRsk;
let expectedNewFederationAddress;
let p2shErpFedRedeemScript;
let expectedNewFederationThreshold;
let amountOfUtxosToMigrate;
let federationBalanceBeforeMigration;
let whitelistingAssertionsTestLegacy;
let rskTxHelpers;
let btcTxHelper;
let rskTxHelper;

/**
 * Takes the blockchain to the required state for this test file to run in isolation.
 */
const fulfillRequirementsToRunAsSingleTestFile = async (rskTxHelper, btcTxHelper) => {
  await rskUtils.activateFork(rskUtils.getLatestForkName());
  await disableWhitelisting(rskTxHelper, btcTxHelper);
};

describe('RSK Federation change', function() {
  let addresses;

  before(async () => {

    try {

      rskClientOldFed = rsk.getClient(Runners.hosts.federate.host);
      await Runners.startAdditionalFederateNodes(await rskClientOldFed.eth.getBlock('latest'));
      btcClient = bitcoin.getClient(
        Runners.hosts.bitcoin.rpcHost,
        Runners.hosts.bitcoin.rpcUser,
        Runners.hosts.bitcoin.rpcPassword,
        NETWORK
      );
      rskClients = Runners.hosts.federates.map(federate => rsk.getClient(federate.host));
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      btcTxHelper = getBtcClient();

      if(process.env.RUNNING_SINGLE_TEST_FILE) {
        await fulfillRequirementsToRunAsSingleTestFile(rskTxHelper, btcTxHelper);
      }

      // Assume the last of the running federators belongs to the new federation
      rskClientNewFed = rskClients[rskClients.length-1];
      pegClient = pegUtils.using(btcClient, rskClientOldFed);
      pegClientNewFed = pegUtils.using(btcClient, rskClientNewFed);
      test = pegAssertions.with(btcClient, rskClientOldFed, pegClient);
      whitelistingAssertionsTestLegacy = whitelistingAssertionsLegacy.with(btcClient, rskClientOldFed, pegClient);
      testNewFed = pegAssertions.with(btcClient, rskClientNewFed, pegClient);
      whitelistingAssertionstestNewFed = whitelistingAssertionsLegacy.with(btcClient, rskClientNewFed, pegClient);
      utils = rskUtilsLegacy.with(btcClient, rskClientOldFed, pegClient);
      utilsNewFed = rskUtilsLegacy.with(btcClient, rskClientNewFed, pegClient);
      
      await rskUtilsLegacy.waitForSync(rskClients);

      // Grab the new federation public keys and calculate the federators addresses and expected federation
      // address from the existing runners. Use compressed public keys for federation change
      newFederationPublicKeys = Runners.hosts.federates
        .filter((federate, index) => index >= INITIAL_FEDERATION_SIZE)
        .map((federate) => ({
          [KEY_TYPE_BTC]: bitcoin.keys.publicKeyToCompressed(federate.publicKeys[KEY_TYPE_BTC]),
          [KEY_TYPE_RSK]: bitcoin.keys.publicKeyToCompressed(federate.publicKeys[KEY_TYPE_RSK]),
          [KEY_TYPE_MST]: bitcoin.keys.publicKeyToCompressed(federate.publicKeys[KEY_TYPE_MST])
        }))
        .sort(compareFederateKeys);

      newFederationBtcPublicKeys = newFederationPublicKeys.map(publicKeys => publicKeys[KEY_TYPE_BTC]);

      newFederatorRskAddressesRsk = newFederationPublicKeys
        .map((publicKeys) =>
          rskClientOldFed.rsk.utils.publicKeyToAddress(
            bitcoin.keys.publicKeyToUncompressed(publicKeys[KEY_TYPE_RSK])
          )
        );

      expectedNewFederationThreshold = newFederationBtcPublicKeys.length / 2 + 1;
      p2shErpFedRedeemScript = redeemScriptParser.getP2shErpRedeemScript(newFederationBtcPublicKeys, ERP_PUBKEYS, ERP_CSV_VALUE);
      expectedNewFederationAddress = redeemScriptParser.getAddressFromRedeemScript('REGTEST', p2shErpFedRedeemScript);

      // Prepend '0x' to public keys
      newFederationPublicKeys = newFederationPublicKeys.map(
        publicKeys => ({
          [KEY_TYPE_BTC]: libUtils.ensure0x(publicKeys[KEY_TYPE_BTC]),
          [KEY_TYPE_RSK]: libUtils.ensure0x(publicKeys[KEY_TYPE_RSK]),
          [KEY_TYPE_MST]: libUtils.ensure0x(publicKeys[KEY_TYPE_MST])
        })
      );

      newFederationBtcPublicKeys = newFederationBtcPublicKeys.map(
        btcPublicKey => libUtils.ensure0x(btcPublicKey)
      );

      // Grab the federation address
      await btcClient.importAddress(await getActiveFederationAddress(), 'federations');
      await btcClient.importAddress(expectedNewFederationAddress, 'federations');
      addresses = await pegClient.generateNewAddress('test');
      expect(addresses.inRSK).to.be.true;
      await whitelistingAssertionsTestLegacy.assertAddOneOffWhitelistAddress(addresses.btc, INITIAL_BTC_BALANCE)();
      await btcClient.sendToAddress(addresses.btc, INITIAL_BTC_BALANCE);
      await btcClient.generate(1);
      await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE, 'Initial BTC balance');

      for (fedAddress of newFederatorRskAddressesRsk) {
        await utils.sendFromCow(fedAddress, rsk.btcToWeis(INITIAL_FEDERATOR_BALANCE_IN_BTC));
      }
      // mine a few rsk blocks to prevent being at the beginning of the chain,
      // which could trigger border cases we're not interested in
      await sequentialPromise(10, () => rskUtils.mineAndSync(rskTxHelpers));

    }
    catch (err){
      throw new CustomError('RSK federation change failure', err);
    }
  });

  it('should import federation change private keys', async () => {
    try{
      var expectedAddresses = REGTEST_FEDERATION_CHANGE_ADDRESSES.concat(EXPECTED_OTHER_ADDRESSES);
      var privateKeys = REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS.concat(OTHER_PKS);
      
      for (privateKey of privateKeys){
        let address = await rskClientOldFed.eth.personal.importRawKey(privateKey, '');
        expect(expectedAddresses.includes(address.substr(2)));
      }
    } catch (err) {
      throw new CustomError('Import federation change private keys failure', err);
    }
  });

  const preventCases = [{
      methodName: 'createFederation',
      getMethod: (client) => client.rsk.bridge.methods.createFederation()
  }, {
      methodName: 'addFederatorPublicKeyMultikey',
      getMethod: (client) => client.rsk.bridge.methods.addFederatorPublicKeyMultikey(
        FEDERATION_RANDOM_PUBLIC_KEY,
        FEDERATION_RANDOM_PUBLIC_KEY,
        FEDERATION_RANDOM_PUBLIC_KEY
      )
  }, {
      methodName: 'commitFederation',
      getMethod: (client) => client.rsk.bridge.methods.commitFederation(PENDING_FEDERATION_RANDOM_HASH)
  }, {
      methodName: 'rollbackFederation',
      getMethod: (client) => client.rsk.bridge.methods.rollbackFederation()
  }];

  for (preventCase of preventCases){
    it(`should prevent calling ${preventCase.methodName} without a correct key`, async () => {
      try{
        var hash = await rskClientOldFed.rsk.bridge.methods.getPendingFederationHash().call();
        expect(hash).to.be.null;

        for (address of EXPECTED_OTHER_ADDRESSES){
          await sendTxWithCheck(preventCase.getMethod(rskClientOldFed), address, (callResult) => {
            expect(Number(callResult)).to.equal(EXPECTED_UNSUCCESSFUL_RESULT);
          })
        }

        hash = await rskClientOldFed.rsk.bridge.methods.getPendingFederationHash().call();
        expect(hash).to.be.null;
      }
      catch (err){
        throw new CustomError(`Prevent calling ${preventCase.methodName} without a correct key failure`, err);
      }
    });
  }

  it('should transfer BTC to RBTC with the initial federation', async () => {
    return test.assertLock(addresses, [{ address: await getActiveFederationAddress(), amount: bitcoin.btcToSatoshis(15) }]);
  });

  it('should create a new pending federation and roll it back', async () => {
    try{
      await unlockFederationChangeAccounts(rskClientOldFed);
      var rollbackResult = await rskClientOldFed.rsk.bridge.methods.rollbackFederation().call({ from: REGTEST_FEDERATION_CHANGE_ADDRESSES[0] });
      expect(Number(rollbackResult)).to.equal(-1);
      await assertCreateNewFederation();
      await sendTxWithCheckMinRequiredVotesTimes(rskClientOldFed.rsk.bridge.methods.rollbackFederation(), (rollbackResult) => {
        // Success
        expect(Number(rollbackResult)).to.equal(1);
      })();
      await assertNoPendingFederation();
    }
    catch (err){
      throw new CustomError('Create new pending federation and roll it back failure', err);
    }
  });

  it('should create a new pending federation', () => {
    return assertCreateNewFederation();
  });

  it('should add public keys to the pending federation', async () => {
    try{
      var checkNewKeyAtOfType = async (index, type) => {
        var key = await rskClientOldFed.rsk.bridge.methods.getPendingFederatorPublicKeyOfType(index, type).call();
        expect(key).to.equal(newFederationPublicKeys[index][type]);
      };

      var checkNewKeyAt = (index) => async () => {
        await checkNewKeyAtOfType(index, KEY_TYPE_BTC);
        await checkNewKeyAtOfType(index, KEY_TYPE_RSK);
        await checkNewKeyAtOfType(index, KEY_TYPE_MST);
      };

      async function checkFederationAddedNewKeys() {
        var federationHash = await rskClientOldFed.rsk.bridge.methods.getPendingFederationHash().call();
        var promises = [];

        for (var fedPubKey of newFederationPublicKeys) {
          promises.push(sendTxWithCheckMinRequiredVotesTimes(
            rskClientOldFed.rsk.bridge.methods.addFederatorPublicKeyMultikey(
              fedPubKey[KEY_TYPE_BTC],
              fedPubKey[KEY_TYPE_RSK],
              fedPubKey[KEY_TYPE_MST]
            ), (addResult) => {
              expect(Number(addResult)).to.equal(1); // success
            })()
          );
        }

        await Promise.all(promises); 
        var pendingFedHash = await rskClientOldFed.rsk.bridge.methods.getPendingFederationHash().call();
        expect(pendingFedHash).to.not.equal(federationHash); // hash should have changed
      }

      await checkFederationAddedNewKeys();
      const addKeysResult = await rskClientOldFed.rsk.bridge.methods.addFederatorPublicKeyMultikey('0xaabb', '0xccdd', '0xeeff').call({ from: getRandomFedChangeAddress() });
      expect(Number(addKeysResult)).to.equal(-10); // not a public key

      const addPublicKeysResult = await rskClientOldFed.rsk.bridge.methods.addFederatorPublicKeyMultikey(
        newFederationPublicKeys[0][KEY_TYPE_BTC],
        newFederationPublicKeys[0][KEY_TYPE_RSK],
        newFederationPublicKeys[0][KEY_TYPE_MST]
      ).call({ from: getRandomFedChangeAddress() });

      expect(Number(addPublicKeysResult)).to.equal(-2);

      var sz = await rskClientOldFed.rsk.bridge.methods.getPendingFederationSize().call();
      expect(Number(sz)).to.equal(newFederationPublicKeys.length); // success

      var pendingFederationSize = await rskClientOldFed.rsk.bridge.methods.getPendingFederationSize().call();
      
      for (var i = 0; i < Number(pendingFederationSize); i++) {
        await checkNewKeyAt(i);
      }
    } catch (err) {
      throw new CustomError('Add public keys to pending federation failure', err);
    }
  });

  // this is not an actual test, this just modifies the blockchain state ensuring that the active federation contains several UTXOs
  it('generates several UTXOs in the active federation', async () => {
    try {

      const EXPECTED_UTXOS = 15;
      const bridgeStatus = await getBridgeState(rskClientNewFed);
      const existingUtxosCount = bridgeStatus.activeFederationUtxos.length;
      amountOfUtxosToMigrate = existingUtxosCount < EXPECTED_UTXOS ? EXPECTED_UTXOS : existingUtxosCount;

      // Ensure there are enough UTXOs so that the migration need to be done in more than one transaction
      if (existingUtxosCount < EXPECTED_UTXOS) {

        const UTXOS_TO_PAY_FEES = 1
        const UTXOS_TO_TRANSFER = EXPECTED_UTXOS - existingUtxosCount;
        const utxosToGenerate = UTXOS_TO_TRANSFER + UTXOS_TO_PAY_FEES;
        const utxoValueInSatoshis = bitcoin.btcToSatoshis(1);
        const peginSenderAddressInfo = await btcTxHelper.generateBtcAddress('legacy');
        const totalFeesInSatoshis = (utxosToGenerate * btcEthUnitConverter.btcToSatoshis(btcTxHelper.getFee()));
        const totalAmountToSendInSatoshis = (utxoValueInSatoshis * utxosToGenerate) + totalFeesInSatoshis;
        
        await btcTxHelper.fundAddress(peginSenderAddressInfo.address, btcEthUnitConverter.satoshisToBtc(totalAmountToSendInSatoshis));

        for(let i = 0; i < utxosToGenerate; i++) {
          const peginBtcTxHash = await sendPegin(rskTxHelper, btcTxHelper, peginSenderAddressInfo, btcEthUnitConverter.satoshisToBtc(utxoValueInSatoshis));
          await ensurePeginIsRegistered(rskTxHelper, peginBtcTxHash);
        }
        
      }

      const finalBridgeStatus = await getBridgeState(rskClientNewFed);
      federationBalanceBeforeMigration = finalBridgeStatus.activeFederationUtxos.reduce(
        (previousValue, currentUtxo) => previousValue + currentUtxo.valueInSatoshis, 0
      );
    } catch (err) {
      throw new CustomError('Generating several UTXOs in the active federation failure', err);
    }
  });

  it('should commit the pending federation and delay its activation', async () => {
    try{
      oldFederation = {};
      oldFederation.address = await getActiveFederationAddress();
      oldFederation.threshold = Number(await rskClientOldFed.rsk.bridge.methods.getFederationThreshold().call());
      oldFederation.creationTime = Number(await rskClientOldFed.rsk.bridge.methods.getFederationCreationTime().call());
      oldFederation.creationBlockNumber = Number(await rskClientOldFed.rsk.bridge.methods.getFederationCreationBlockNumber().call());
      var federationSize = await rskClientOldFed.rsk.bridge.methods.getFederationSize().call();
      oldFederation.publicKeys = [];

      for (var i = 0; i < Number(federationSize); i++) {
        await getIndexAndAssignResult(rskClientOldFed, 'getFederatorPublicKeyOfType', i, oldFederation.publicKeys)();
      }

      var commitResult = await rskClientOldFed.rsk.bridge.methods.commitFederation(PENDING_FEDERATION_RANDOM_HASH).call({ from: getRandomFedChangeAddress() });
      expect(Number(commitResult)).to.equal(-3); // hash mismatch

      var federationHash = await rskClientOldFed.rsk.bridge.methods.getPendingFederationHash().call();
      var commitReceipt = await sendTxWithCheckMinRequiredVotesTimes(rskClientOldFed.rsk.bridge.methods.commitFederation(federationHash), (commitResult) => {
        expect(Number(commitResult)).to.equal(1); // success
      })();

      var block = await rskClientOldFed.eth.getBlock(commitReceipt.blockHash);
      expectedNewFederationCreationTime = block.timestamp;
      expectedNewFederationCreationBlockNumber = block.number;

      var address = await getActiveFederationAddress();
      expect(address).to.equal(oldFederation.address);

      var threshold = await rskClientOldFed.rsk.bridge.methods.getFederationThreshold().call();
      expect(Number(threshold)).to.equal(oldFederation.threshold);

      var creationTime = await rskClientOldFed.rsk.bridge.methods.getFederationCreationTime().call();
      expect(Number(creationTime)).to.equal(oldFederation.creationTime);

      var creationBlockNumber = await rskClientOldFed.rsk.bridge.methods.getFederationCreationBlockNumber().call();
      expect(Number(creationBlockNumber)).to.equal(oldFederation.creationBlockNumber);

      federationSize = await rskClientOldFed.rsk.bridge.methods.getFederationSize().call();
      expect(Number(federationSize)).to.equal(oldFederation.publicKeys.length);

      for (var i = 0; i < Number(federationSize); i++) {
        await getIndexAndExpectResult(rskClientOldFed, 'getFederatorPublicKeyOfType', i, oldFederation.publicKeys)();
      }

      // 20 blocks is what takes to activate the new federation in regtest. Mine half
      // and check no activation happened
      await sequentialPromise(FEDERATION_ACTIVATION_AGE / 2, () => rskUtils.mineAndSync(rskTxHelpers));

      // Check retiring federation is still not assigned
      address = await getRetiringFederationAddress();
      expect(address).to.equal('');

      threshold = await rskClientOldFed.rsk.bridge.methods.getRetiringFederationThreshold().call();
      expect(Number(threshold)).to.equal(-1);

      creationTime = await rskClientOldFed.rsk.bridge.methods.getRetiringFederationCreationTime().call();
      expect(Number(creationTime)).to.equal(-1);

      creationBlockNumber = await rskClientOldFed.rsk.bridge.methods.getRetiringFederationCreationBlockNumber().call();
      expect(Number(creationBlockNumber)).to.equal(-1);

      federationSize = await rskClientOldFed.rsk.bridge.methods.getRetiringFederationSize().call();
      expect(Number(federationSize)).to.equal(-1);

      await assertNoPendingFederation();

      commitResult = await rskClientOldFed.rsk.bridge.methods.commitFederation(PENDING_FEDERATION_RANDOM_HASH).call({ from: getRandomFedChangeAddress() });
      expect(Number(commitResult)).to.equal(-1);

      createResult = await rskClientOldFed.rsk.bridge.methods.createFederation().call({ from: getRandomFedChangeAddress() });
      expect(Number(createResult)).to.equal(-2);
    }
    catch (err) {
      throw new CustomError('Commit the pending federation and delay its activation failure', err);
    }
  });

  it('should activate the new federation and assign the retiring federation', async () => {
    try {
      // 20 blocks is what takes to activate the new federation in regtest.
      // Already mined at least 10 before. Mine 20 more and check.
      await sequentialPromise(FEDERATION_ACTIVATION_AGE, () => rskUtils.mineAndSync(rskTxHelpers));

      // Check new federation
      var activeFederationAddress = await getActiveFederationAddress();
      expect(activeFederationAddress).to.equal(expectedNewFederationAddress);

      var threshold = await rskClientNewFed.rsk.bridge.methods.getFederationThreshold().call();
      expect(Number(threshold)).to.equal(expectedNewFederationThreshold);

      var creationTime = await rskClientNewFed.rsk.bridge.methods.getFederationCreationTime().call();
      expect(Number(creationTime)).to.equal(expectedNewFederationCreationTime);

      var creationBlockNumber = await rskClientNewFed.rsk.bridge.methods.getFederationCreationBlockNumber().call();
      expect(Number(creationBlockNumber)).to.equal(expectedNewFederationCreationBlockNumber);

      var federationSize = await rskClientNewFed.rsk.bridge.methods.getFederationSize().call();
      expect(Number(federationSize)).to.equal(newFederationPublicKeys.length);

      for (var i = 0; i < Number(federationSize); i++) {
        await getIndexAndExpectResult(rskClientNewFed, 'getFederatorPublicKeyOfType', i, newFederationPublicKeys)();
      }

      // Check retiring federation same as old federation
      let retiringFederationAddress = await getRetiringFederationAddress();
      expect(retiringFederationAddress).to.equal(oldFederation.address);

      threshold = await rskClientNewFed.rsk.bridge.methods.getRetiringFederationThreshold().call();
      expect(Number(threshold)).to.equal(oldFederation.threshold);

      creationTime = await rskClientNewFed.rsk.bridge.methods.getRetiringFederationCreationTime().call();
      expect(Number(creationTime)).to.equal(oldFederation.creationTime);

      creationBlockNumber = await rskClientNewFed.rsk.bridge.methods.getRetiringFederationCreationBlockNumber().call();
      expect(Number(creationBlockNumber)).to.equal(oldFederation.creationBlockNumber);

      federationSize = await rskClientNewFed.rsk.bridge.methods.getRetiringFederationSize().call();
      expect(Number(federationSize)).to.equal(oldFederation.publicKeys.length);

      for (var i = 0; i < Number(federationSize); i++) {
        await getIndexAndExpectResult(rskClientNewFed, 'getRetiringFederatorPublicKeyOfType', i, oldFederation.publicKeys)();
      }

      // Check no pending federation
      await assertNoPendingFederation();

      // Trying to commit again fails expectedly
      var commitResult = await rskClientNewFed.rsk.bridge.methods.commitFederation(PENDING_FEDERATION_RANDOM_HASH).call({ from: getRandomFedChangeAddress() });
      expect(Number(commitResult)).to.equal(-1);

      // Trying to create a new federation fails cause we're awaiting funds migration
      var createResult = await rskClientNewFed.rsk.bridge.methods.createFederation().call({ from: getRandomFedChangeAddress() });
      expect(Number(createResult)).to.equal(-3);
    }
    catch (err) {
      throw new CustomError('Activate the new federation and assign the retiring federation failure', err);
    }
  });
  
  it('should migrate all funds from the retiring federation', async () => {
    try{
      var activeFederationAddress = await getActiveFederationAddress();
      await btcClient.importAddress(activeFederationAddress, 'federations');
      var retiringFederationAddress = await getRetiringFederationAddress();
      var retiringFederationAddressesBalances = await btcClient.getAddressBalance([retiringFederationAddress].concat(additionalFederationAddresses.get()));
      expect(retiringFederationAddressesBalances).to.have.property(retiringFederationAddress);
      
      var rawRetiringFederationBalance = retiringFederationAddressesBalances[retiringFederationAddress];
      expect(rawRetiringFederationBalance).to.be.finite;
      expect(rawRetiringFederationBalance).to.be.greaterThan(0, 'Retiring federation should have some balance to migrate');

      await sequentialPromise(20, (index) => {
        return rskUtils.mineAndSync(rskTxHelpers);
      });

      await rskUtilsLegacy.waitForSync(rskClients);

      let expectedMigrations = Math.ceil(amountOfUtxosToMigrate / MAX_INPUTS_PER_MIGRATION_TRANSACTION);
      let releaseCreatedCallback = rskUtilsLegacy.getBridgeEventAndRunAssertions('release_requested', checkReleaseConfirmed, rsk, 20);

      const rskTxHelper = rskTxHelpers[rskTxHelpers.length - 1];

      const blockNumberBeforeTriggerRelease = await rskTxHelper.getBlockNumber();
      for (let i = 0; i < expectedMigrations; i++) {  
        await rskUtilsLegacy.triggerRelease(
          rskClients, 
          btcClient, 
          releaseCreatedCallback, 
          null
        );
      }

      const releaseRskEvents = new Set();
      const pegoutReleaseCheckCallback = async (pegoutReleaseEvent) => {
        expect(pegoutReleaseEvent).to.not.be.null;
        const btcTransaction = await btcTxHelper.parseRawTransaction(removePrefix0x(pegoutReleaseEvent.arguments.btcRawTransaction));
        expect(btcTransaction.version).to.be.eq(2);

        releaseRskEvents.add(pegoutReleaseEvent.arguments.releaseRskTxHash);
        return releaseRskEvents.size === expectedMigrations;
      };

      const latestBlockNumber = await rskTxHelper.getBlockNumber();
      await rskUtils.findEventInBlock(rskTxHelper, 'release_btc', blockNumberBeforeTriggerRelease, latestBlockNumber, pegoutReleaseCheckCallback);

      btcBalances = await btcClient.getAddressBalance(activeFederationAddress);
      expect(btcBalances).to.have.property(activeFederationAddress);

      await btcClient.generate(3); // for adding them back to RSK
      await rskClientNewFed.fed.updateBridge();
      await rskUtils.mineAndSync(rskTxHelpers);

      const bridgeStatus = await getBridgeState(rskClientNewFed);
      const utxosAfterMigration = bridgeStatus.activeFederationUtxos.length;
      const federationBalanceAfterMigration = bridgeStatus.activeFederationUtxos.reduce(
        (previousValue, currentUtxo) => previousValue + currentUtxo.valueInSatoshis, 0
      );
      
      // Balance after migration is reduced after paying fees for migration transactions
      expect(federationBalanceAfterMigration).to.be.within(federationBalanceBeforeMigration * 0.9, federationBalanceBeforeMigration);
      
      // Should have one utxo in the new federation for each migration transaction
      expect(utxosAfterMigration).to.equal(expectedMigrations);
    } catch (err) {
      throw new CustomError('Migrating all funds from the retiring federation failure', err);
    }
  });

  it('should release all federation funds after migration', async () => {
    try{
      const SEND_TX_GAS = 44000 // 21000 (default contract method call) + 23000 (releaseBtc bridge method call)
      const SEND_TX_GAS_PRICE = 1
      const SEND_TX_MINING_PRICE = SEND_TX_GAS * SEND_TX_GAS_PRICE
      const BTC_TX_FEE = 30600

      var currentFederationAddress = await getActiveFederationAddress();
      var btcBalances = await btcClient.getAddressBalance(currentFederationAddress);
      expect(btcBalances).to.have.property(currentFederationAddress);
      
      var prevFederationBalance = new BN(rsk.satoshisToWeis(btcBalances[currentFederationAddress]) + '');
      var newAccountAddress = await pegClientNewFed.generateNewAddress('to_release_funds');
      expect(newAccountAddress.inRSK).to.be.true;

      var cowAddress = await rskClientNewFed.eth.personal.newAccountWithSeed('cow');
      await rskClientNewFed.rsk.sendTx({
        from: cowAddress,
        to: newAccountAddress.rsk,
        value: prevFederationBalance.add(new BN(SEND_TX_MINING_PRICE)).toString(10)
      }, () => rskUtils.mineAndSync(rskTxHelpers));

      var newAccountBalance = await rskClientNewFed.eth.getBalance(newAccountAddress.rsk);
      expect(new BN(newAccountBalance).eq(prevFederationBalance.add(new BN(SEND_TX_MINING_PRICE)))).to.be.true;

      var unlockResult = await rskClientNewFed.eth.personal.unlockAccount(newAccountAddress.rsk, '');
      expect(unlockResult).to.be.true;

      await rskClientNewFed.rsk.sendTx({
        from: newAccountAddress.rsk,
        to: rsk.getBridgeAddress(),
        value: prevFederationBalance.toString(10),
        gas: SEND_TX_GAS,
        gasPrice: SEND_TX_GAS_PRICE
      }, () => rskUtils.mineAndSync(rskTxHelpers));

      await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);
      await wait(3000);
      btcBalances = await btcClient.getAddressBalance([newAccountAddress.btc]);
      const expectedNewAccountBalance = rsk.weisToSatoshis(prevFederationBalance.toString(10)) - BTC_TX_FEE;
      expect(Number(expectedNewAccountBalance)).to.be.greaterThan(0);
      expect(Number(expectedNewAccountBalance)).to.be.at.most(Number(prevFederationBalance));
      //expect(btcBalances).to.have.property(newAccountAddress.btc, expectedNewAccountBalance, 'Not existing BTC balance');  

      newAccountBalance = await rskClientNewFed.eth.getBalance(newAccountAddress.rsk);
      expect(Number(newAccountBalance)).to.equal(0, 'Not all funds have been released');

      btcBalances = await btcClient.getAddressBalance([currentFederationAddress]);
      expect(btcBalances).to.not.have.property(currentFederationAddress, undefined, 'There is still balance in the federation');
    }
    catch (err) {
      throw new CustomError('Release federation funds after migration failure', err);
    }
  });

  it('should not create a new federation (transfer from retiring not done)', async () => {
    try{
      await assertNoPendingFederation();
      var createResult = await rskClientOldFed.rsk.bridge.methods.createFederation().call({ from: getRandomFedChangeAddress() });
      // There's transfer between the retiring federation and the active federation pending
      expect(Number(createResult)).to.equal(-3);
    }
    catch (err) {
      throw new CustomError('Should not create a new federation (transfer from retiring not done) failure', err); 
    }
  });

  it('should transfer BTC to RBTC with the new federation', async () => {
    try{
      // Mine some blocks (20) and the wait for nodes to sync so that the
      // federate nodes start being aware of the federation changes
      var valueToTransfer = bitcoin.btcToSatoshis(5);
      await sequentialPromise(FEDERATION_ACTIVATION_AGE, () => rskUtils.mineAndSync(rskTxHelpers));
      await rskUtilsLegacy.waitForSync(rskClients);
      await whitelistingAssertionstestNewFed.assertAddOneOffWhitelistAddress(addresses.btc, valueToTransfer);
      await testNewFed.assertLock(
        addresses,
        [{ address: await getActiveFederationAddress(), amount: valueToTransfer}]
      );
    }
    catch (err) {
      throw new CustomError('Transfer BTC to RBTC with the new federation failure', err);
    }
  });

  it('should transfer BTC to RBTC with the retiring federation', async () => {
    try{
      // Wait for nodes to sync
      let retiringFederationAddress = await getRetiringFederationAddress();
      expect(retiringFederationAddress).not.to.be.equal('');

      var valueToTransfer = bitcoin.btcToSatoshis(7);
      await rskUtilsLegacy.waitForSync(rskClients);
      await whitelistingAssertionstestNewFed.assertAddOneOffWhitelistAddress(addresses.btc, valueToTransfer);
      await test.assertLock(
        addresses,
        [{ address: retiringFederationAddress, amount: valueToTransfer }]
      );
    }
    catch (err) {
      throw new CustomError('Transfer BTC to RBTC with the retiring federation failure', err);
    }
  });

  it('should transfer BTC to RBTC with outputs to both federations', async () => {
    try {
      let retiringFederationAddress = await getRetiringFederationAddress();
      expect(retiringFederationAddress).not.to.be.equal('');

      var outputs = [
        { address: await getActiveFederationAddress(), amount: bitcoin.btcToSatoshis(23) },
        { address: retiringFederationAddress, amount: bitcoin.btcToSatoshis(17) },
      ];
      
      await test.assertLock(addresses, outputs);
    }
    catch (err) {
      throw new CustomError('Transfer BTC to RBTC with outputs both federations failure', err);
    }
  });

});

const getActiveFederationAddress = async() => {
    return rskClientNewFed.rsk.bridge.methods.getFederationAddress().call();
};

const getRetiringFederationAddress = async() => {
    return rskClientNewFed.rsk.bridge.methods.getRetiringFederationAddress().call();
};

var assertNoPendingFederation = async () => {
  try{
    var hash = await rskClientOldFed.rsk.bridge.methods.getPendingFederationHash().call({ from: getRandomFedChangeAddress() });
    expect(hash).to.be.null;

    var size = await rskClientOldFed.rsk.bridge.methods.getPendingFederationSize().call({ from: getRandomFedChangeAddress() });
    expect(Number(size)).to.equal(-1);
  }
  catch (err) {
    throw new CustomError('Assert no pending federation failure', err);
  }
};

var assertCreateNewFederation = async () => {
  try{
    await assertNoPendingFederation();

    var createResult = await sendTxWithCheckMinRequiredVotesTimes(rskClientOldFed.rsk.bridge.methods.createFederation(), (createResult) => {
      expect(Number(createResult)).to.equal(1); // success
    })();

    var hash = await rskClientOldFed.rsk.bridge.methods.getPendingFederationHash().call();
    expect(hash).to.be.a('string');
    expect(hash.length).to.equal(66); // 32 bytes hex + prefix '0x'

    var sz = await rskClientOldFed.rsk.bridge.methods.getPendingFederationSize().call();
    // Expecting pending federation size to be zero
    expect(Number(sz)).to.equal(0);

    createResult = await rskClientOldFed.rsk.bridge.methods.createFederation().call({ from: getRandomFedChangeAddress() });
    // Trying to create again should yield -1
    expect(Number(createResult)).to.equal(-1); 
  }
  catch (err) {
    throw new CustomError('Assert create new federation failure', err); 
  }
};

var sendTxWithCheck = (method, check, fromAddress) => () => {
  var txReceiptPromise = method.call({ from: fromAddress }).then(check).then(() =>
    method.send({ from: fromAddress || getRandomFedChangeAddress(), value: '0', gasPrice: '0' })
  );

  var mined = false;
  var mineTimeout;

  var executeMine = () => {
    mineTimeout = null;
    rskUtils.mineAndSync(rskTxHelpers).then(() => wait(100)).then(() => {
      if (!mined) {
        mineTimeout = setTimeout(executeMine, 500);
      }
    });
  };

  // Mine until we get the tx receipt
  executeMine();

  return txReceiptPromise.then((txReceipt) => {
    mined = true;
    if (mineTimeout != null) {
      clearTimeout(mineTimeout);
    }
    return txReceipt;
  });
};

var sendTxWithCheckMinRequiredVotesTimes = (method, check) => { 
  return sendTxWithCheckWithAddresses(
    method,
    check, randomNElements(
      REGTEST_FEDERATION_CHANGE_ADDRESSES,
      Math.floor(REGTEST_FEDERATION_CHANGE_ADDRESSES.length / 2) + 1
    )
  );
};

var sendTxWithCheckWithAddresses = (method, check, addresses) => async () => {
  var result;
  for (address of addresses){
    result = await sendTxWithCheck(method, check, address)();
  }
  return result;
};

var unlockFederationChangeAccounts = async (client) => {
  for (address of REGTEST_FEDERATION_CHANGE_ADDRESSES){
    var unlockResult = await client.eth.personal.unlockAccount(address, '');
    expect(unlockResult).to.be.true;
  }
};

var getRandomFedChangeAddress = () => randomElement(REGTEST_FEDERATION_CHANGE_ADDRESSES);

var getIndexTypeAndAssignResult = (client, method, index, type, destination) => {
  var getter = client.rsk.bridge.methods[method].bind(client.rsk.bridge.methods);
  return getter(index, type).call().then((result) => {
    destination[index][type] = result;
  });
};

var getIndexAndAssignResult = (client, method, index, destination) => async () => {
  destination[index] = {};
  await getIndexTypeAndAssignResult(client, method, index, KEY_TYPE_BTC, destination);
  await getIndexTypeAndAssignResult(client, method, index, KEY_TYPE_RSK, destination);
  await getIndexTypeAndAssignResult(client, method, index, KEY_TYPE_MST, destination);
};

var getIndexTypeAndExpectResult = (client, method, index, type, source) => {
  var getter = client.rsk.bridge.methods[method].bind(client.rsk.bridge.methods);
  return getter(index, type).call().then((result) => {
    expect(result).to.equal(source[index][type], `Key does not match: ${method}, ${index}, ${type}, ${source}`);
  });
};

var getIndexAndExpectResult = (client, method, index, source) => async () => {
  await getIndexTypeAndExpectResult(client, method, index, KEY_TYPE_BTC, source);
  await getIndexTypeAndExpectResult(client, method, index, KEY_TYPE_RSK, source);
  await getIndexTypeAndExpectResult(client, method, index, KEY_TYPE_MST, source);
};

var checkReleaseConfirmed = async (decodedLog, rskClient, additionalData) => {
  expect(decodedLog[0]).to.be.equals(additionalData.txHash);
  expect(decodedLog[1]).to.not.be.undefined;
}
