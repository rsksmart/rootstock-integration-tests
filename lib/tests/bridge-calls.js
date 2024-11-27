const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const fs = require('fs');
const CustomError = require('../CustomError');
const rskUtils = require('../rsk-utils');
const solUtils = require('../sol-utils');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getBridge } = require('../bridge-provider');

const INITIAL_RSK_BALANCE_IN_BTC = 1;
const BRIDGE_ADDRESS = '0x0000000000000000000000000000000001000006';
const BRIDGE_TESTER_FILE = './contracts/contract-calls-tester.sol'; // Relative to tests root
const BRIDGE_TESTER_CONTRACT_NAME = 'ContractCallsTester';
const SOLIDITY_COMPILER_VERSION = 'v0.4.16+commit.d7661dd9';

let rskClient;
let rskTransactionHelper;
let address;
let contractCallsTester;

const execute = (description, getRskHost, bridgeCallsAllowed) => {
  describe(description, () => {
    before(async () => {
      rskTransactionHelper = getRskTransactionHelper(getRskHost());
      rskClient = rskTransactionHelper.getClient();
      address = await rskClient.eth.personal.newAccount('');
      await rskUtils.sendFromCow(rskTransactionHelper, address, Number(btcEthUnitConverter.btcToWeis(INITIAL_RSK_BALANCE_IN_BTC)));
      await rskClient.eth.personal.unlockAccount(address, '');
    });

    it('should create the testing contract', async () => {
      try{
        const source = fs.readFileSync(BRIDGE_TESTER_FILE).toString();
        
        contractCallsTester = await solUtils.compileAndDeploy(
          SOLIDITY_COMPILER_VERSION,
          source,
          BRIDGE_TESTER_CONTRACT_NAME,
          [BRIDGE_ADDRESS],
          rskTransactionHelper,
          {
            from: address
          }
        );
        
        const areYouAliveResult = await contractCallsTester.methods.areYouAlive().call();
        expect(areYouAliveResult).to.equal('yes i am');
      } 
      catch (err) {
        throw new CustomError('Contract creation failure', err);
      }
    });

    const partialTestMethod = testMethod(bridgeCallsAllowed);

    partialTestMethod('getMinimumLockTxValue()', [], '0');
    partialTestMethod('getFederationAddress()', [], '');
    partialTestMethod('getFederationCreationBlockNumber()', [], '0');
    partialTestMethod('getFederationCreationTime()', [], '0');
    partialTestMethod('getFederationSize()', [], '0');
    partialTestMethod('getFederationThreshold()', [], '0');
    partialTestMethod('getFeePerKb()', [], '0');
    partialTestMethod('getPendingFederationSize()', [], '0');
    partialTestMethod('getRetiringFederationSize()', [], '0');
    partialTestMethod('getRetiringFederationThreshold()', [], '0');
    partialTestMethod('getRetiringFederationCreationTime()', [], '0');
    partialTestMethod('getRetiringFederationCreationBlockNumber()', [], '0');
    // TODO: investigate why these two methods are treated as local calls instead of mined calls with "solc": "^0.7.5"
    // partialTestMethod('getBtcTxHashProcessedHeight(string)', ['001122334455667788990011223344556677889900112233445566778899aabb'], '0');
    // partialTestMethod('getStateForDebugging()', [], '');
  });
}

const testMethod = (bridgeCallsAllowed) => (methodSignature, args, expectedWhenFail) => {
  const pos = methodSignature.indexOf('(');
  const methodName = methodSignature.substr(0, pos);

  describe(methodName, () => {
    let bridgeMethod;
    let abi;

    before(() => {
      const bridge = getBridge(rskClient);
      bridgeMethod = bridge.methods[methodName].apply(null, args);
      abi = bridgeMethod.encodeABI();
    });

    it('normal call works', async () => {
      try{
        const result = await bridgeMethod.call();

        if (expectedWhenFail === null) {
          expect(result).to.not.be.null;
        } else {
          expect(result).to.not.equal(expectedWhenFail);
        }
      } catch (err) {
        throw new CustomError('Normal call failure', err);
      }
    });

    it(`contract calls allowed`, async () => {
      const success = await contractCallsTester.methods.doCall(abi).call();
      expect(success).to.be.true;
    });

  });
};

module.exports = { execute };
