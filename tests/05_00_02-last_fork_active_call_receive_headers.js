const receiveHeadersTests = require('../lib/tests/call_receive_headers');

receiveHeadersTests.execute('Calling receiveHeaders after federation change', () => Runners.hosts.federate.host);
