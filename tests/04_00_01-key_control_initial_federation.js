const fedAssertions = require('../lib/assertions/fed');

var fedAssert;

const INITIAL_FEDERATION_SIZE = 5;

describe('Federate nodes key control - initial federation', function() {
  before(() => {
    fedAssert = fedAssertions.with(Runners.hosts.federates);
  });

  it('can update bridge', () => {
    // No need to send money to the original federation
    // since bridge txs are free for them
    // Thus no third parameter
    return fedAssert.assertKeyControl(0, INITIAL_FEDERATION_SIZE);
  });
});
