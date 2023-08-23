const bridgeCallsTests = require('../lib/tests/bridge-calls');

bridgeCallsTests.execute('Bridge calls and txs from contracts to constant fns (pre-orchid)', () => Runners.hosts.federate.host, false);
