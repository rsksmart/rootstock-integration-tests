const twoWpTests = require('../lib/tests/post_iris_call_receive_headers');

twoWpTests.execute('Calling receiveHeaders after federation change', () => Runners.hosts.federate.host);