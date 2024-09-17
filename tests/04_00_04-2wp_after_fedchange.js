const twoWpTests = require('../lib/tests/2wp-legacy');

twoWpTests.execute(
  'BTC <=> RSK 2WP after federation change',
  () => Runners.hosts.federates[Runners.hosts.federates.length-1].host
);
