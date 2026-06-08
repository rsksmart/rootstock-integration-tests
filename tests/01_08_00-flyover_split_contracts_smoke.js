const expect = require('chai').expect;
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');
const {
    REQUIRED_SMOKE_ENV_VARS,
    skipIfMissingEnvVars,
    getExpectedContractAddresses,
    assertSplitContractsDeployed,
    getProviderId,
    selectProvider,
    buildQuoteRequest,
    normalizeBaseUrl,
    toLower,
    httpRequest,
} = require('../lib/flyover-smoke-test-utils');

describe('Flyover split-contract smoke test (LPS + regtest wiring)', function () {
    let rskTxHelper;
    let flyoverLpsUrl;
    let expectedContractAddresses;
    let quoteRequest;
    let providerId;

    before(async function () {
        skipIfMissingEnvVars.call(this, REQUIRED_SMOKE_ENV_VARS);

        rskTxHelper = getRskTransactionHelper();
        flyoverLpsUrl = normalizeBaseUrl(process.env.FLYOVER_LPS_URL);
        expectedContractAddresses = getExpectedContractAddresses();
        providerId = getProviderId();

        await assertSplitContractsDeployed(rskTxHelper, expectedContractAddresses);
        quoteRequest = buildQuoteRequest();
    });

    it('should fetch health/providers, get quote, and accept pegin quote', async function () {
        const healthResponse = await httpRequest(`${flyoverLpsUrl}/health`);
        expect(healthResponse.statusCode, 'LPS health endpoint should be reachable').to.equal(200);
        expect(healthResponse.body).to.have.property('status');

        const providersResponse = await httpRequest(`${flyoverLpsUrl}/getProviders`);
        expect(providersResponse.statusCode, '/getProviders should return 200').to.equal(200);
        expect(providersResponse.body).to.be.an('array').that.is.not.empty;

        const provider = selectProvider(
            providersResponse.body,
            providerId,
            `Provider id ${providerId} not found in /getProviders response`
        );
        const providerApiBaseUrl = normalizeBaseUrl(provider.apiBaseUrl);

        const providerDetailsResponse = await httpRequest(`${providerApiBaseUrl}/providers/details`);
        expect(providerDetailsResponse.statusCode, '/providers/details should return 200').to.equal(200);
        expect(providerDetailsResponse.body).to.have.property('pegin');
        expect(providerDetailsResponse.body).to.have.property('pegout');

        const getQuoteResponse = await httpRequest(
            `${providerApiBaseUrl}/pegin/getQuote`,
            'POST',
            quoteRequest
        );
        expect(getQuoteResponse.statusCode, '/pegin/getQuote should return 200').to.equal(200);
        expect(getQuoteResponse.body).to.be.an('array').that.is.not.empty;
        const quoteResult = getQuoteResponse.body[0];
        expect(quoteResult).to.have.property('quoteHash');
        expect(quoteResult).to.have.property('quote');
        expect(quoteResult.quote).to.have.property('lbcAddr');
        expect(toLower(quoteResult.quote.lbcAddr)).to.equal(expectedContractAddresses.pegin);

        const acceptQuoteResponse = await httpRequest(
            `${providerApiBaseUrl}/pegin/acceptQuote`,
            'POST',
            { quoteHash: quoteResult.quoteHash }
        );
        expect(acceptQuoteResponse.statusCode, '/pegin/acceptQuote should return 200').to.equal(200);
        expect(acceptQuoteResponse.body).to.have.property('signature');
        expect(acceptQuoteResponse.body).to.have.property('bitcoinDepositAddressHash');
    });
});
