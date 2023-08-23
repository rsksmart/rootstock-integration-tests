const expect = require('chai').expect
var { sequentialPromise, wait } = require('../lib/utils');
const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const pegAssertions = require('../lib/assertions/2wp');
const whitelistingAssertionsLegacy = require('../lib/assertions/whitelisting-legacy');
const CustomError = require('../lib/CustomError');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');

describe('Transfer BTC to RBTC before papyrus200', function() {

  var federationAddress;
  var btcClient;
  var rskClient;
  var pegClient;
  var test;
  let whitelistTestLegacy;
  let rskTxHelpers;
  let btcTxHelper;

  const NETWORK = bitcoin.networks.testnet;
  
  before(async () => {
    btcClient = bitcoin.getClient(
      Runners.hosts.bitcoin.rpcHost,
      Runners.hosts.bitcoin.rpcUser,
      Runners.hosts.bitcoin.rpcPassword,
      NETWORK
    );
    rskClient = rsk.getClient(Runners.hosts.federate.host);
    rskClients = Runners.hosts.federates.map(federate => rsk.getClient(federate.host));
    pegClient = pegUtils.using(btcClient, rskClient);
    test = pegAssertions.with(btcClient, rskClient, pegClient);
    whitelistTestLegacy = whitelistingAssertionsLegacy.with(btcClient, rskClient, pegClient);
    rskTxHelpers = getRskTransactionHelpers();
    btcTxHelper = getBtcClient();

    // Grab the federation address
    federationAddress = await rskClient.rsk.bridge.methods.getFederationAddress().call();
    await btcClient.importAddress(federationAddress, 'federations');
    
    // Mine a few rsk blocks to prevent being at the beginning of the chain,
    // which could trigger border cases we're not interested in
    await sequentialPromise(10, () => rskUtils.mineAndSync(rskTxHelpers));
    
    // // Update the bridge to sync btc blockchains
    await rskClient.fed.updateBridge();
    await rskUtils.mineAndSync(rskTxHelpers);

    return federationAddress;
  });

  it('should transfer BTC to RBTC', async () => {
    try {
      var initialFedBalance = (await btcClient.getAddressBalance(federationAddress))[federationAddress] || 0;
      expect(initialFedBalance).to.be.lessThan(bitcoin.btcToSatoshis(1000));
      
      const INITIAL_RSK_BALANCE = bitcoin.btcToSatoshis(1000) + bitcoin.btcToSatoshis(1);
      const INITIAL_BTC_BALANCE = INITIAL_RSK_BALANCE + bitcoin.btcToSatoshis(1);
      const TO_BRIDGE_GAS_PRICE = 1;
      const WEIS_TO_RELEASE = '500000000000000000000';

      var addresses = await pegClient.generateNewAddress('test');
      expect(addresses.inRSK).to.be.true;

      await whitelistTestLegacy.assertAddLimitedLockWhitelistAddress(addresses.btc, INITIAL_BTC_BALANCE)();
      await btcClient.sendToAddress(addresses.btc, INITIAL_BTC_BALANCE);
      await btcClient.generate(1);
      await test.assertBitcoinBalance(addresses.btc, INITIAL_BTC_BALANCE, "Wrong initial BTC balance");
      await wait(1000);
      await test.assertLock(addresses, [{ address: federationAddress, amount: INITIAL_RSK_BALANCE }]);

      var lockedFedBalance = Number((await btcClient.getAddressBalance(federationAddress))[federationAddress]);
      expect(lockedFedBalance).to.be.greaterThan(bitcoin.btcToSatoshis(1000) + initialFedBalance);

      await rskClient.eth.personal.unlockAccount(addresses.rsk, '');

      //Need to call sendTx in order to make it always with value < 1000, otherwise it fails
      await rskClient.rsk.sendTx({
        from: addresses.rsk,
        to: rsk.getBridgeAddress(),
        value: WEIS_TO_RELEASE,
        gasPrice: TO_BRIDGE_GAS_PRICE
      }, rskClient.evm.mine);

      //Call release after sendTx so requests are released. Goes one by one
      await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);

      await wait(500);
      
      var afterFirstReleaseFedBalance = Number((await btcClient.getAddressBalance(federationAddress))[federationAddress]);
      expect(afterFirstReleaseFedBalance).to.be.at.most(INITIAL_BTC_BALANCE / 2 + initialFedBalance);

      //Need to call sendTx in order to make it always with value < 1000, otherwise it fails
      await rskClient.rsk.sendTx({
        from: addresses.rsk,
        to: rsk.getBridgeAddress(),
        value: WEIS_TO_RELEASE,
        gasPrice: TO_BRIDGE_GAS_PRICE
      }, rskClient.evm.mine);

      //Call release after sendTx so requests are released. Goes one by one
      await rskUtils.triggerRelease(rskTxHelpers, btcTxHelper);
      
      var finalFedBalance = Number((await btcClient.getAddressBalance(federationAddress))[federationAddress]);
      expect(finalFedBalance).to.be.at.most(initialFedBalance + bitcoin.btcToSatoshis(1));
    } 
    catch (err) {
      throw new CustomError('Transfer BTC to RBTC failure', err);
    }
  });
});
