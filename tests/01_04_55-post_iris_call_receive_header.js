const expect = require('chai').expect;

const peglib = require('peglib');
const bitcoin = peglib.bitcoin;
const rsk = peglib.rsk;
const pegUtils = peglib.pegUtils;
const libUtils = require('../lib/utils');
const rskUtilsLegacy = require('../lib/rsk-utils-legacy');
const CustomError = require('../lib/CustomError');
const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

const NETWORK = bitcoin.networks.testnet;
let rskTxHelpers;

describe('Calling method receiveHeader after iris300', function() {
  
    before(() => {
        rskClient = rsk.getClient(Runners.hosts.federate.host);
        btcClient = bitcoin.getClient(
            Runners.hosts.bitcoin.rpcHost,
            Runners.hosts.bitcoin.rpcUser,
            Runners.hosts.bitcoin.rpcPassword,
            NETWORK
        );

        pegClient = pegUtils.using(btcClient, rskClient);
        utils = rskUtilsLegacy.with(btcClient, rskClient, pegClient);
        rskTxHelpers = getRskTransactionHelpers();
    });
  
    it('should return 0 and increment BTC blockchain size when calling receiveHeader method', async () => {
        try {
            let cowAddress = await rskClient.eth.personal.newAccountWithSeed('cow');
          
            await rskClient.fed.updateBridge();
            await rskUtils.mineAndSync(rskTxHelpers);
            let blockHash = await btcClient.generate(1);
            let blockHeader = await btcClient.getBlockHeader(blockHash[0], false);

            let blockchainInitialHeigth = await rskClient.rsk.bridge.methods.getBtcBlockchainBestChainHeight().call();

            await utils.sendTxWithCheck(
                rskClient.rsk.bridge.methods.receiveHeader(libUtils.ensure0x(blockHeader)),
                (result) => { expect(Number(result)).to.be.equal(0) },
                cowAddress
            )();

            let blockchainFinalHeight = await rskClient.rsk.bridge.methods.getBtcBlockchainBestChainHeight().call();
            expect(Number(blockchainFinalHeight)).to.be.equal(Number(blockchainInitialHeigth) + 1);
        }
        catch (err) {
            throw new CustomError('receiveHeader call failure', err);
        }
    });

    it('should return -1 when calling receiveHeader method consecutively', async () => {
        try {
            let blockHash = await btcClient.generate(1);
            let blockHeader = await btcClient.getBlockHeader(blockHash[0], false);
            let result = await rskClient.rsk.bridge.methods.receiveHeader(libUtils.ensure0x(blockHeader)).call();
            expect(result).to.be.equal('-1');
        }
        catch (err) {
          throw new CustomError('receiveHeader call failure', err);
        }
    });
});

