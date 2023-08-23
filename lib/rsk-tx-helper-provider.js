const { RskTransactionHelper } = require('rsk-transaction-helper');

/**
 * Creates and returns a list of RskTransactionHelper instances for each federate node
 * @param {Object[]} federates
 * @returns {RskTransactionHelper[]}
 */
const getRskTransactionHelpers = (federates) => {
    federates = federates || Runners.hosts.federates;
    const rskTransactionHelpers = federates.map(federate => getRskTransactionHelper(federate.host));
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
    return rskTransactionHelper;
};

module.exports = {
    getRskTransactionHelpers,
    getRskTransactionHelper,
};
