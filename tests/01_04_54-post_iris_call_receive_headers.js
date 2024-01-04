const receiveHeadersTests = require('../lib/tests/call_receive_headers');

receiveHeadersTests.execute('Calling receiveHeaders after iris300', () => Runners.hosts.federate.host);
