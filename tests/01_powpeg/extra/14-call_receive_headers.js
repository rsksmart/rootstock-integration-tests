const receiveHeadersTests = require('../../../lib/tests/call_receive_headers');

receiveHeadersTests.execute(
    '@regression @bridge-methods Calling receiveHeaders',
    () => Runners.hosts.federate.host
);
