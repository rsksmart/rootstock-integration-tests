const receiveHeaderTests = require('../lib/tests/call_receive_header');

receiveHeaderTests.execute('Calling receiveHeader after iris300', () => Runners.hosts.federate.host);
