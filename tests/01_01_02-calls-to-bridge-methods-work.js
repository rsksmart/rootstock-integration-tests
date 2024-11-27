const bridgeCallsTests = require('../lib/tests/bridge-calls');

bridgeCallsTests.execute('Bridge calls and txs from contracts to constant fns', () => Runners.hosts.federate.host);
