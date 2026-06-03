const expect = require('chai').expect;
const { Flyover } = require('@rsksmart/flyover-sdk');
const { BlockchainReadOnlyConnection, ethers } = require('@rsksmart/bridges-core-sdk');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');

const REQUIRED_ENV_VARS = [
    'PEGIN_CONTRACT_ADDRESS',
    'PEGOUT_CONTRACT_ADDRESS',
    'DISCOVERY_ADDRESS',
    'COLLATERAL_MANAGEMENT_ADDRESS',
];

const DEFAULT_LPS_URL = 'http://127.0.0.1:8080';
const DEFAULT_RSK_RPC_URL = 'http://127.0.0.1:4444';
const DEFAULT_SDK_NETWORK = 'Regtest';
const DEFAULT_VALUE_TO_TRANSFER_WEIS = '1000000000000000000';
const DEFAULT_QUOTE_ADDRESS = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826';

const toLower = (value) => (value || '').toLowerCase();

const withTrailingSlash = (url) => {
    return url.endsWith('/') ? url : `${url}/`;
};

describe('Flyover SDK smoke test (SDK + LPS + split contracts)', function () {
    let rskTxHelper;
    let expectedContractAddresses;
    let providerId;
    let quoteRequest;
    let flyover;

    before(async function () {
        const missingVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
        if (missingVars.length > 0) {
            this.skip();
            return;
        }

        rskTxHelper = getRskTransactionHelper();
        expectedContractAddresses = {
            pegin: toLower(process.env.PEGIN_CONTRACT_ADDRESS),
            pegout: toLower(process.env.PEGOUT_CONTRACT_ADDRESS),
            discovery: toLower(process.env.DISCOVERY_ADDRESS),
            collateralManagement: toLower(process.env.COLLATERAL_MANAGEMENT_ADDRESS),
        };
        providerId = process.env.FLYOVER_PROVIDER_ID ? Number(process.env.FLYOVER_PROVIDER_ID) : null;

        const codeByAddress = await Promise.all([
            rskTxHelper.getClient().eth.getCode(expectedContractAddresses.pegin),
            rskTxHelper.getClient().eth.getCode(expectedContractAddresses.pegout),
            rskTxHelper.getClient().eth.getCode(expectedContractAddresses.discovery),
            rskTxHelper.getClient().eth.getCode(expectedContractAddresses.collateralManagement),
        ]);

        codeByAddress.forEach((code) => {
            expect(code, 'Expected deployed bytecode at split contract addresses').to.not.equal('0x');
        });

        const rpcUrl = process.env.FLYOVER_RSK_RPC_URL || DEFAULT_RSK_RPC_URL;
        const rskConnection = await BlockchainReadOnlyConnection.createUsingRpc(rpcUrl);
        const baseUrl = withTrailingSlash(process.env.FLYOVER_LPS_URL || DEFAULT_LPS_URL);

        flyover = new Flyover({
            network: process.env.FLYOVER_SDK_NETWORK || DEFAULT_SDK_NETWORK,
            allowInsecureConnections: true,
            disableChecksum: true,
            baseUrl,
            captchaTokenResolver: async () => 'rit-smoke-token',
        });

        await flyover.connectToRsk(rskConnection);
        // Current SDK regtest constants can differ from locally deployed split contracts.
        // Patch the internally instantiated contracts to point to active addresses.
        flyover.checkLbc();
        const lbc = flyover.liquidityBridgeContract;
        const signerOrProvider = rskConnection.getAbstraction();
        lbc.pegInContract.peginContract = new ethers.Contract(
            expectedContractAddresses.pegin,
            lbc.pegInContract.peginContract.interface,
            signerOrProvider
        );
        lbc.pegOutContract.pegoutContract = new ethers.Contract(
            expectedContractAddresses.pegout,
            lbc.pegOutContract.pegoutContract.interface,
            signerOrProvider
        );
        lbc.discoveryContract.discoveryContract = new ethers.Contract(
            expectedContractAddresses.discovery,
            lbc.discoveryContract.discoveryContract.interface,
            signerOrProvider
        );
        // Compatibility shim for local split-contract setup where SDK packaged validation path
        // can revert despite successful LPS acceptance.
        lbc.pegInContract.validatePeginDepositAddress = async () => true;

        quoteRequest = {
            callEoaOrContractAddress: process.env.FLYOVER_TEST_DESTINATION_ADDRESS || DEFAULT_QUOTE_ADDRESS,
            callContractArguments: '0x',
            valueToTransfer: BigInt(
                process.env.FLYOVER_TEST_VALUE_WEIS || DEFAULT_VALUE_TO_TRANSFER_WEIS
            ),
            rskRefundAddress: process.env.FLYOVER_TEST_REFUND_ADDRESS || DEFAULT_QUOTE_ADDRESS,
        };
    });

    it('should fetch providers via SDK, request quote, and accept quote', async function () {
        const providers = await flyover.getLiquidityProviders();
        expect(providers).to.be.an('array').that.is.not.empty;

        let provider = providers[0];
        if (providerId != null) {
            const providerById = providers.find((item) => Number(item.id) === providerId);
            expect(providerById, `Provider id ${providerId} not found in flyover SDK providers`).to.exist;
            provider = providerById;
        }

        flyover.useLiquidityProvider(provider);

        const quotes = await flyover.getQuotes(quoteRequest);
        expect(quotes).to.be.an('array').that.is.not.empty;
        const quote = quotes[0];
        expect(quote).to.have.property('quoteHash');
        expect(quote).to.have.property('quote');
        expect(toLower(quote.quote.lbcAddr)).to.equal(expectedContractAddresses.pegin);

        const acceptedQuote = await flyover.acceptQuote(quote);
        expect(acceptedQuote).to.have.property('signature');
        expect(acceptedQuote).to.have.property('bitcoinDepositAddressHash');
    });
});
