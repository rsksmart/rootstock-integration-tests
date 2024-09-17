const twoWpTests = require('../lib/tests/2wp-new');

twoWpTests.execute('BTC <=> RSK 2WP', () => Runners.hosts.federate.host);
