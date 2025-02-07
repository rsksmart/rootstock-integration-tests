const { RskTransactionHelper } = require('rsk-transaction-helper');
const { extendWeb3WithRskModule } = require('../lib/web3-utils');

/**
 * Creates and returns a list of RskTransactionHelper instances for each federate node
 * @param {Object[]} federates
 * @returns {RskTransactionHelper[]}
 */
const getRskTransactionHelpers = (federates) => {
    federates = federates || Runners.hosts.federates;
    const rskTransactionHelpers = federates.map(federate => {
        const rskTxHelper = getRskTransactionHelper(federate.host);
        extendWeb3WithRskModule(rskTxHelper.getClient());
        return rskTxHelper;
    });
    return rskTransactionHelpers;
};

/**
 * Create and returns a RskTransactionHelper instance for a given host
 * @param {string} host for rsk client. Defaults to the global Runners.hosts.federate.host
 * @param {number} maxAttempts for transaction retries. Defaults to 5
 * @returns {RskTransactionHelper}
 */
const getRskTransactionHelper = (host, maxAttempts = 5) => {
    const rskTransactionHelper = new RskTransactionHelper({ hostUrl: host || Runners.hosts.federate.host, maxAttempts });
    extendWeb3WithRskModule(rskTransactionHelper.getClient());
    return rskTransactionHelper;
};

module.exports = {
    getRskTransactionHelpers,
    getRskTransactionHelper,
};
