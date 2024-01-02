const twoWpTests = require('../lib/tests/post_iris_call_receive_headers');

twoWpTests.execute('Calling receiveHeaders after iris300', () => Runners.hosts.federate.host);