const receiveHeaderTests = require('../lib/tests/call_receive_header');

receiveHeaderTests.execute('Calling receiveHeader after federation change', () => Runners.hosts.federates[Runners.hosts.federates.length - 1].host);
