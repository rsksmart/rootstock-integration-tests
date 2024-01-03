const twoWpTests = require('../lib/tests/post_iris_call_receive_header');

twoWpTests.execute('Calling receiveHeader after federation change', () => Runners.hosts.federates[Runners.hosts.federates.length - 1].host);