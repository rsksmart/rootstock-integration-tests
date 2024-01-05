const receiveHeaderTests = require('../lib/tests/call_receive_header');

receiveHeaderTests.execute('Calling receiveHeader last fork is active', () => Runners.hosts.federate.host);
