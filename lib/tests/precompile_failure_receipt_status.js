const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const fs = require('node:fs');
const BN = require('bn.js');
const rskUtils = require('../rsk-utils');
const solUtils = require('../sol-utils');
const { getRskTransactionHelper } = require('../rsk-tx-helper-provider');
const { getBridge } = require('../bridge-provider');
const { BRIDGE_ADDRESS } = require('../constants/bridge-constants');

const INVALID_BRIDGE_DATA = '0xdeadbeef';
const GAS_LIMIT = 100000;
const MIN_GAS_PRICE_IN_WEIS = new BN('1000000000');
const EXECUTION_FAILED_ERROR_CODE = -32015;
const EXECUTION_FAILED_ERROR_MESSAGE =
    'VM Exception while processing transaction: execution failed';
const EMPTY_LOGS_BLOOM = `0x${'0'.repeat(512)}`;

const CONTRACT_CALLS_TESTER_FILE = './contracts/contract-calls-tester.sol'; // Relative to tests root
const CONTRACT_CALLS_TESTER_NAME = 'ContractCallsTester';
const SOLIDITY_COMPILER_VERSION = 'v0.4.16+commit.d7661dd9';

let rskTxHelper;
let rskClient;
let bridge;
let senderAddress;

/**
 * Sends a JSON-RPC request straight to the provider. web3 drops the error code and turns
 * the receipt status into a boolean, so the raw response is what carries the wire values.
 */
const sendRawRpc = (method, params) =>
    new Promise((resolve, reject) => {
        rskClient.currentProvider.send(
            { jsonrpc: '2.0', id: Date.now(), method, params },
            (err, response) => (err ? reject(err) : resolve(response))
        );
    });

const expectExecutionFailedError = (response) => {
    expect(response.error, `Expected a JSON-RPC error, got ${JSON.stringify(response)}`).to.exist;
    expect(response.error.code).to.equal(EXECUTION_FAILED_ERROR_CODE);
    expect(response.error.message).to.equal(EXECUTION_FAILED_ERROR_MESSAGE);
};

/**
 * Sends `txParams` to the bridge, mines it and returns the raw receipt. The web3 promise
 * rejects on a failed receipt, so its outcome is ignored and the receipt is read directly.
 */
const sendToBridgeAndGetRawReceipt = async (txParams) => {
    const txReceiptPromise = rskClient.eth.sendTransaction({ to: BRIDGE_ADDRESS, ...txParams });
    txReceiptPromise.catch(() => {});

    const txHash = await new Promise((resolve, reject) => {
        txReceiptPromise.once('transactionHash', resolve);
        txReceiptPromise.once('error', reject);
    });

    const isTxInTheMempool = await rskUtils.waitForRskTxToBeInTheMempool(rskTxHelper, txHash, 10);
    expect(isTxInTheMempool, `The tx (${txHash}) did not reach the mempool`).to.be.true;

    await rskUtils.mineWithSubmitterAndSync(rskTxHelper);

    const { result: receipt } = await sendRawRpc('eth_getTransactionReceipt', [txHash]);
    expect(receipt, `The tx (${txHash}) was not mined`).to.not.be.null;
    return receipt;
};

const execute = (description) => {
    describe(description, () => {
        before(async () => {
            rskTxHelper = getRskTransactionHelper();
            rskClient = rskTxHelper.getClient();
            bridge = await getBridge(rskClient);
            senderAddress = await rskUtils.getNewFundedRskAddress(rskTxHelper);
        });

        describe('Direct transaction with invalid data', () => {
            let gasPrice;
            let balanceBefore;
            let balanceAfter;
            let receipt;

            before(async () => {
                const nodeGasPrice = new BN(await rskClient.eth.getGasPrice());
                gasPrice = BN.max(nodeGasPrice, MIN_GAS_PRICE_IN_WEIS);

                balanceBefore = new BN(await rskClient.eth.getBalance(senderAddress));
                receipt = await sendToBridgeAndGetRawReceipt({
                    from: senderAddress,
                    data: INVALID_BRIDGE_DATA,
                    gas: GAS_LIMIT,
                    gasPrice: gasPrice.toString(),
                });
                balanceAfter = new BN(await rskClient.eth.getBalance(senderAddress));
            });

            it('should report a failed status and the whole gas limit as gas used', () => {
                expect(receipt.status).to.equal('0x0');
                expect(Number(receipt.gasUsed)).to.equal(GAS_LIMIT);
            });

            it('should charge the sender exactly gasUsed * gasPrice', () => {
                const expectedFee = new BN(GAS_LIMIT).mul(gasPrice);
                expect(balanceBefore.sub(balanceAfter).toString()).to.equal(expectedFee.toString());
            });

            it('should not emit any log', () => {
                expect(receipt.logs).to.be.empty;
                expect(receipt.logsBloom).to.equal(EMPTY_LOGS_BLOOM);
            });
        });

        describe('Local execution of a federation-only method from a regular account', () => {
            let callParams;

            before(() => {
                callParams = {
                    from: senderAddress,
                    to: BRIDGE_ADDRESS,
                    data: bridge.methods.updateCollections().encodeABI(),
                };
            });

            it('should make eth_call return the execution failed error', async () => {
                expectExecutionFailedError(await sendRawRpc('eth_call', [callParams, 'latest']));
                await expect(
                    bridge.methods.updateCollections().call({ from: senderAddress })
                ).to.be.rejectedWith(/execution failed/);
            });

            it('should make eth_estimateGas return the execution failed error', async () => {
                expectExecutionFailedError(await sendRawRpc('eth_estimateGas', [callParams]));
                await expect(
                    bridge.methods.updateCollections().estimateGas({ from: senderAddress })
                ).to.be.rejectedWith(/execution failed/);
            });
        });

        describe('Failing bridge call made from a contract', () => {
            let contractCallsTester;

            before(async () => {
                const source = fs.readFileSync(CONTRACT_CALLS_TESTER_FILE).toString();
                contractCallsTester = await solUtils.compileAndDeploy(
                    SOLIDITY_COMPILER_VERSION,
                    source,
                    CONTRACT_CALLS_TESTER_NAME,
                    [BRIDGE_ADDRESS],
                    rskTxHelper,
                    { from: senderAddress }
                );
            });

            // The direct-call rule does not apply to internal calls: the bridge failure only
            // makes the CALL return false, and this caller does not revert on it
            it('should not emit a bridge log and leave the outer transaction successful', async () => {
                const updateCollectionsData = bridge.methods.updateCollections().encodeABI();
                const doCallMethod = contractCallsTester.methods.doCall(updateCollectionsData);

                expect(await doCallMethod.call({ from: senderAddress })).to.be.false;

                const txReceipt = await rskUtils.sendTransaction(
                    rskTxHelper,
                    doCallMethod,
                    senderAddress,
                    0,
                    GAS_LIMIT * 2
                );
                const { result: rawReceipt } = await sendRawRpc('eth_getTransactionReceipt', [
                    txReceipt.transactionHash,
                ]);

                expect(rawReceipt.status).to.equal('0x1');
                const bridgeLogs = rawReceipt.logs.filter(
                    (log) => log.address.toLowerCase() === BRIDGE_ADDRESS.toLowerCase()
                );
                expect(bridgeLogs).to.be.empty;
            });
        });
    });
};

module.exports = {
    execute,
};
