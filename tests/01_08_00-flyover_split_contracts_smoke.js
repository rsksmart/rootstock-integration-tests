const expect = require('chai').expect;
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');

const REQUIRED_ENV_VARS = [
    'FLYOVER_LPS_URL',
    'PEGIN_CONTRACT_ADDRESS',
    'PEGOUT_CONTRACT_ADDRESS',
    'DISCOVERY_ADDRESS',
    'COLLATERAL_MANAGEMENT_ADDRESS',
];

const DEFAULT_VALUE_TO_TRANSFER_WEIS = '1000000000000000000';
const DEFAULT_QUOTE_ADDRESS = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826';

const toLower = (value) => (value || '').toLowerCase();

const normalizeBaseUrl = (url) => {
    return url.endsWith('/') ? url.slice(0, -1) : url;
};

const stringifyJsonKeepingBigInts = (body) => {
    return JSON.stringify(body, (_, value) => {
        if (typeof value === 'bigint') {
            return `__BIGINT__${value.toString()}__`;
        }
        return value;
    }).replace(/"__BIGINT__(-?\d+)__"/g, '$1');
};

const buildRequestOptions = (url, method, bodyString) => {
    const parsedUrl = new URL(url);
    const headers = {
        Accept: 'application/json',
    };
    if (bodyString != null) {
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyString);
    }
    return {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method,
        headers,
    };
};

const httpRequest = (url, method = 'GET', body = null) => {
    return new Promise((resolve, reject) => {
        const bodyString = body == null ? null : stringifyJsonKeepingBigInts(body);
        const requestOptions = buildRequestOptions(url, method, bodyString);
        const requestFn = requestOptions.protocol === 'https:' ? https.request : http.request;
        const req = requestFn(requestOptions, (res) => {
            let responseText = '';
            res.on('data', (chunk) => {
                responseText += chunk.toString();
            });
            res.on('end', () => {
                let parsedBody = null;
                if (responseText.length > 0) {
                    try {
                        parsedBody = JSON.parse(responseText);
                    } catch (e) {
                        parsedBody = responseText;
                    }
                }
                resolve({
                    statusCode: res.statusCode,
                    body: parsedBody,
                    rawBody: responseText,
                });
            });
        });
        req.on('error', reject);
        if (bodyString != null) {
            req.write(bodyString);
        }
        req.end();
    });
};

describe('Flyover split-contract smoke test (LPS + regtest wiring)', function () {
    let rskTxHelper;
    let flyoverLpsUrl;
    let providerApiBaseUrl;
    let expectedContractAddresses;
    let quoteRequest;
    let providerId;

    before(async function () {
        const missingVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]);
        if (missingVars.length > 0) {
            this.skip();
            return;
        }

        rskTxHelper = getRskTransactionHelper();
        flyoverLpsUrl = normalizeBaseUrl(process.env.FLYOVER_LPS_URL);
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

        const refundAddress = process.env.FLYOVER_TEST_REFUND_ADDRESS || DEFAULT_QUOTE_ADDRESS;
        const destinationAddress =
            process.env.FLYOVER_TEST_DESTINATION_ADDRESS || DEFAULT_QUOTE_ADDRESS;

        quoteRequest = {
            callEoaOrContractAddress: destinationAddress,
            callContractArguments: '0x',
            valueToTransfer: BigInt(
                process.env.FLYOVER_TEST_VALUE_WEIS || DEFAULT_VALUE_TO_TRANSFER_WEIS
            ),
            rskRefundAddress: refundAddress,
        };
    });

    it('should fetch health/providers, get quote, and accept pegin quote', async function () {
        const healthResponse = await httpRequest(`${flyoverLpsUrl}/health`);
        expect(healthResponse.statusCode, 'LPS health endpoint should be reachable').to.equal(200);
        expect(healthResponse.body).to.have.property('status');

        const providersResponse = await httpRequest(`${flyoverLpsUrl}/getProviders`);
        expect(providersResponse.statusCode, '/getProviders should return 200').to.equal(200);
        expect(providersResponse.body).to.be.an('array').that.is.not.empty;

        let provider = providersResponse.body[0];
        if (providerId != null) {
            const providerById = providersResponse.body.find((item) => Number(item.id) === providerId);
            expect(providerById, `Provider id ${providerId} not found in /getProviders response`).to
                .exist;
            provider = providerById;
        }

        providerApiBaseUrl = normalizeBaseUrl(provider.apiBaseUrl);

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
