const rsk = require('peglib').rsk;
const fedAssertions = require('../lib/assertions/fed');

let fedAssert;

const INITIAL_FEDERATION_SIZE = 3;
const INITIAL_FEDERATOR_BALANCE_IN_BTC = 1;

// TODO: refactor this test to get rid of the peglib library
describe('Federate nodes key control - second federation', function() {
  before(() => {
    console.log('Runners.hosts.federates.length', Runners.hosts.federates.length);
    fedAssert = fedAssertions.with(Runners.hosts.federates);
  });

  it('can update bridge', () => {
    // We need to send some money to these
    // federate nodes since bridge
    // txs aren't free for them
    return fedAssert.assertKeyControl(INITIAL_FEDERATION_SIZE, Runners.hosts.federates.length,
      rsk.btcToWeis(INITIAL_FEDERATOR_BALANCE_IN_BTC));
  });
});
