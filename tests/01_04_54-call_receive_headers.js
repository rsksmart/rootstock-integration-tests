const receiveHeadersTests = require('../lib/tests/call_receive_headers');

receiveHeadersTests.execute('Calling receiveHeaders', () => Runners.hosts.federate.host);
