const expect = require('chai').expect
const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const libUtils = require('../lib/utils');
const CustomError = require('../lib/CustomError');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const { disableWhitelisting } = require('../lib/2wp-utils');

const NETWORK = bitcoin.networks.testnet;
let rskTxHelpers;
let rskTxHelper;
const fulfillRequirementsToRunAsSingleTestFile = async (rskTxHelper, btcTxHelper) => {
  const latestForkName = rskUtils.getLatestForkName();
  await rskUtils.activateFork(latestForkName);
  await disableWhitelisting(rskTxHelper, btcTxHelper);
};

describe('Calling registerFastBridgeBtcTransaction after last fork', function() {
  
    before( async () => {
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
      btcTxHelper = getBtcClient();
      if(process.env.RUNNING_SINGLE_TEST_FILE) {
        await fulfillRequirementsToRunAsSingleTestFile(rskTxHelper, btcTxHelper);
      }
      rskClient = rsk.getClient(Runners.hosts.federate.host);
      btcClient = bitcoin.getClient(
        Runners.hosts.bitcoin.rpcHost,
        Runners.hosts.bitcoin.rpcUser,
        Runners.hosts.bitcoin.rpcPassword,
        NETWORK
      );
      pegClient = pegUtils.using(btcClient, rskClient);
      utils = rskUtilsLegacy.with(btcClient, rskClient, pegClient);
    });
  
    it('should return error when user calling registerFastBridgeBtcTransaction method', async () => {
      try {
          let errorUserCalls = -300;
          let randomHex = rskClient.utils.randomHex;
          let stringHex = randomHex(32);
          let randomAddress = randomHex(20);
          let addressBtc = (await pegClient.generateNewAddress('test')).btc;
          let addressBtcBytes = libUtils.ensure0x(bitcoin.addresses.decodeBase58Address(addressBtc));
          let callResult = await rskClient.rsk.bridge.methods.registerFastBridgeBtcTransaction("0x", 1, stringHex, stringHex, addressBtcBytes, randomAddress, addressBtcBytes, false).call();
          expect(Number(callResult)).to.equal(errorUserCalls);
      }
      catch (err) {
        throw new CustomError('registerFastBridgeBtcTransaction call failure', err);
      }
    })
});
