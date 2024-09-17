const twoWpTests = require('../lib/tests/2wp-legacy');

twoWpTests.execute('BTC <=> RSK 2WP (pre-orchid)', () => Runners.hosts.federate.host);
