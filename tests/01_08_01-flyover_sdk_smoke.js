const expect = require('chai').expect;
const { Flyover } = require('@rsksmart/flyover-sdk');
const { BlockchainReadOnlyConnection } = require('@rsksmart/bridges-core-sdk');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');
const {
    REQUIRED_SMOKE_ENV_VARS,
    DEFAULT_LPS_URL,
    DEFAULT_RSK_RPC_URL,
    DEFAULT_SDK_NETWORK,
    skipIfMissingEnvVars,
    getExpectedContractAddresses,
    assertSplitContractsDeployed,
    getProviderId,
    selectProvider,
    buildQuoteRequest,
    withTrailingSlash,
    toLower,
    applyLocalSplitContractSdkShim,
} = require('../lib/flyover-smoke-test-utils');

describe('Flyover SDK smoke test (SDK + LPS + split contracts)', function () {
    let rskTxHelper;
    let expectedContractAddresses;
    let providerId;
    let quoteRequest;
    let flyover;

    before(async function () {
        skipIfMissingEnvVars.call(this, REQUIRED_SMOKE_ENV_VARS);

        rskTxHelper = getRskTransactionHelper();
        expectedContractAddresses = getExpectedContractAddresses();
        providerId = getProviderId();

        await assertSplitContractsDeployed(rskTxHelper, expectedContractAddresses);

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
        applyLocalSplitContractSdkShim(flyover, rskConnection, expectedContractAddresses);
        quoteRequest = buildQuoteRequest();
    });

    it('should fetch providers via SDK, request quote, and accept quote', async function () {
        const providers = await flyover.getLiquidityProviders();
        expect(providers).to.be.an('array').that.is.not.empty;

        const provider = selectProvider(
            providers,
            providerId,
            `Provider id ${providerId} not found in flyover SDK providers`
        );

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
