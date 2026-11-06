/**
 * The node configuration this scenario runs on, exported in the same shape `CONFIG_FILE_PATH`
 * points at for the regular suite.
 *
 * It starts the 3 member regtest genesis federation with 2 nodes, which is half of it plus one,
 * and leaves the other 18 federators of the pool configured and peered but not started, ready to
 * be brought up as the federation grows.
 */
const { buildScenarioConfig } = require('../lib/federation-config-builder');

const GENESIS_FEDERATION_SIZE = 3;

module.exports = buildScenarioConfig({
    scenarioName: 'federation-growth',
    initialFederationSize: GENESIS_FEDERATION_SIZE,
});
