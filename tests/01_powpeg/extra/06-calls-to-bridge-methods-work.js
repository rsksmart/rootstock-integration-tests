const bridgeCallsTests = require('../../../lib/tests/bridge-calls');

bridgeCallsTests.execute(
    '@regression @bridge-methods Bridge calls and txs from contracts to constant fns',
    () => Runners.hosts.federate.host
);
