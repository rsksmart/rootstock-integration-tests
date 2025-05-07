const expect = require('chai').expect
const bitcoinJs = require('bitcoinjs-lib');
const rskUtils = require('../lib/rsk-utils');
const { wait, ensure0x, retryWithCheck }  = require('../lib/utils');
const CustomError = require('../lib/CustomError');
const { getBridge } = require('../lib/bridge-provider');
const { getBtcClient } = require('../lib/btc-client-provider');
const btcEthUnitConverter = require('@rsksmart/btc-eth-unit-converter');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

const { getLogger } = require('../logger');

describe('Calling coinbase information methods', () => {

    const logger = getLogger();
    let btcClient;
    let rskTxHelper;
    let rskTxHelpers;
    
    before(() => {
      btcClient = getBtcClient();
      rskTxHelpers = getRskTransactionHelpers();
      rskTxHelper = rskTxHelpers[0];
    });
  
    it('should work when calling Bridge coinbase related methods', async () => {
      try {

        const rskTxSenderAddress = await rskTxHelper.newAccountWithSeed('test'); 
        // Funding the `from` address to pay for fees
        await rskUtils.sendFromCow(rskTxHelper, rskTxSenderAddress, Number(btcEthUnitConverter.btcToWeis(0.1)));

        const blockHash = await btcClient.mine(1);
        await wait(1000);
        await rskTxHelper.updateBridge();
        await rskUtils.waitForRskMempoolToGetNewTxs(rskTxHelper);

        const blockData = await btcClient.nodeClient.getBlock(blockHash[0], false);
        const block = bitcoinJs.Block.fromHex(blockData);
        const coinbaseTx = block.transactions[0];

        // Check coinbase tx hash is equals merkleroot
        expect(coinbaseTx.getHash().toString('hex')).equals(block.merkleRoot.toString('hex'));

        const witnessReservedValue = coinbaseTx.ins[0].witness[0].toString('hex');

        // Remove witness from transaction
        const coinbaseTxWithoutWitness = bitcoinJs.Transaction.fromBuffer(coinbaseTx.__toBuffer(undefined, undefined, false));
        expect(coinbaseTxWithoutWitness.getHash().toString('hex')).equals(coinbaseTx.getHash().toString('hex'));

        const pmt = `0100000001${coinbaseTx.getHash().toString('hex')}0101`;

        const bridge = await getBridge(rskTxHelper.getClient());

        const registerBtcCoinbaseTransactionMethod = bridge.methods.registerBtcCoinbaseTransaction(
          ensure0x(coinbaseTxWithoutWitness.toHex()), 
          ensure0x(blockHash[0]), 
          ensure0x(pmt), 
          ensure0x(witnessReservedValue), 
          ensure0x(witnessReservedValue)
        );

        const txReceipt = await rskUtils.sendTransaction(rskTxHelper, registerBtcCoinbaseTransactionMethod, rskTxSenderAddress);

        expect(txReceipt).not.to.be.null;

        const hash = ensure0x(blockHash[0]);

        const hasBtcBlockCoinbaseTransactionInformationMethod = bridge.methods.hasBtcBlockCoinbaseTransactionInformation(hash).call;

        const check = (resultSoFar, currentAttempts) => {
          console.log(`Attempting to get the btc block coinbase information in the bridge for hash: ${hash}, attempt: ${currentAttempts}.`);
          return resultSoFar;
        };

        const { result: hasBtcBlockCoinbaseInformation } = await retryWithCheck(hasBtcBlockCoinbaseTransactionInformationMethod, check);

        expect(hasBtcBlockCoinbaseInformation).to.be.true;

      } catch (err) {
        throw new CustomError('registerBtcCoinbaseTransaction call failure', err);
      }
    });
});
