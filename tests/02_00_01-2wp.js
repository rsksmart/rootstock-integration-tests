const twoWpTests = require('../lib/tests/2wp');

twoWpTests.execute('BTC <=> RSK 2WP', () => Runners.hosts.federate.host);
