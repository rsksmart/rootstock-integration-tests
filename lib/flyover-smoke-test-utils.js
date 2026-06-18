const expect = require('chai').expect;
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const REQUIRED_CONTRACT_ENV_VARS = [
    'PEGIN_CONTRACT_ADDRESS',
    'PEGOUT_CONTRACT_ADDRESS',
    'DISCOVERY_ADDRESS',
    'COLLATERAL_MANAGEMENT_ADDRESS',
];

const REQUIRED_SMOKE_ENV_VARS = [...REQUIRED_CONTRACT_ENV_VARS, 'FLYOVER_LPS_URL'];

const DEFAULT_VALUE_TO_TRANSFER_WEIS = '1000000000000000000';
const DEFAULT_QUOTE_ADDRESS = '0xcd2a3d9f938e13cd947ec05abc7fe734df8dd826';
const DEFAULT_LPS_URL = 'http://127.0.0.1:8080';
const DEFAULT_RSK_RPC_URL = 'http://127.0.0.1:4444';
const DEFAULT_SDK_NETWORK = 'Regtest';

const toLower = (value) => (value || '').toLowerCase();

const normalizeBaseUrl = (url) => {
    return url.endsWith('/') ? url.slice(0, -1) : url;
};

const withTrailingSlash = (url) => {
    return url.endsWith('/') ? url : `${url}/`;
};

const getMissingEnvVars = (requiredVars) => {
    return requiredVars.filter((name) => !process.env[name]);
};

const skipIfMissingEnvVars = function (requiredVars) {
    const missingVars = getMissingEnvVars(requiredVars);
    if (missingVars.length > 0) {
        this.skip();
    }
};

const getExpectedContractAddresses = () => {
    return {
        pegin: toLower(process.env.PEGIN_CONTRACT_ADDRESS),
        pegout: toLower(process.env.PEGOUT_CONTRACT_ADDRESS),
        discovery: toLower(process.env.DISCOVERY_ADDRESS),
        collateralManagement: toLower(process.env.COLLATERAL_MANAGEMENT_ADDRESS),
    };
};

const assertSplitContractsDeployed = async (rskTxHelper, expectedContractAddresses) => {
    const codeByAddress = await Promise.all([
        rskTxHelper.getClient().eth.getCode(expectedContractAddresses.pegin),
        rskTxHelper.getClient().eth.getCode(expectedContractAddresses.pegout),
        rskTxHelper.getClient().eth.getCode(expectedContractAddresses.discovery),
        rskTxHelper.getClient().eth.getCode(expectedContractAddresses.collateralManagement),
    ]);

    codeByAddress.forEach((code) => {
        expect(code, 'Expected deployed bytecode at split contract addresses').to.not.equal('0x');
    });
};

const getProviderId = () => {
    return process.env.FLYOVER_PROVIDER_ID ? Number(process.env.FLYOVER_PROVIDER_ID) : null;
};

const selectProvider = (providers, providerId, notFoundMessage) => {
    let provider = providers[0];
    if (providerId != null) {
        const providerById = providers.find((item) => Number(item.id) === providerId);
        expect(providerById, notFoundMessage).to.exist;
        provider = providerById;
    }
    return provider;
};

const buildQuoteRequest = () => {
    return {
        callEoaOrContractAddress:
            process.env.FLYOVER_TEST_DESTINATION_ADDRESS || DEFAULT_QUOTE_ADDRESS,
        callContractArguments: '0x',
        valueToTransfer: BigInt(
            process.env.FLYOVER_TEST_VALUE_WEIS || DEFAULT_VALUE_TO_TRANSFER_WEIS
        ),
        rskRefundAddress: process.env.FLYOVER_TEST_REFUND_ADDRESS || DEFAULT_QUOTE_ADDRESS,
    };
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
                    } catch {
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

/**
 * POC shim: SDK regtest constants may not match locally deployed split contracts.
 * Re-point SDK contract instances and bypass on-chain deposit-address validation until
 * SDK regtest addresses align with the external LPS setup.
 */
const applyLocalSplitContractSdkShim = (flyover, rskConnection, expectedContractAddresses) => {
    const { ethers } = require('@rsksmart/bridges-core-sdk');

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
    lbc.pegInContract.validatePeginDepositAddress = async () => true;
};

module.exports = {
    REQUIRED_CONTRACT_ENV_VARS,
    REQUIRED_SMOKE_ENV_VARS,
    DEFAULT_VALUE_TO_TRANSFER_WEIS,
    DEFAULT_QUOTE_ADDRESS,
    DEFAULT_LPS_URL,
    DEFAULT_RSK_RPC_URL,
    DEFAULT_SDK_NETWORK,
    toLower,
    normalizeBaseUrl,
    withTrailingSlash,
    skipIfMissingEnvVars,
    getExpectedContractAddresses,
    assertSplitContractsDeployed,
    getProviderId,
    selectProvider,
    buildQuoteRequest,
    httpRequest,
    applyLocalSplitContractSdkShim,
};
