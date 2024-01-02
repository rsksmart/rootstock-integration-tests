const twoWpTests = require('../lib/tests/post_iris_call_receive_header');

twoWpTests.execute('Calling receiveHeader after arrowhead600', () => Runners.hosts.federate.host);