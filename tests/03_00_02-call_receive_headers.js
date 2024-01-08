const receiveHeadersTests = require('../lib/tests/call_receive_headers');

receiveHeadersTests.execute('Calling receiveHeaders last fork is active', () => Runners.hosts.federate.host);
