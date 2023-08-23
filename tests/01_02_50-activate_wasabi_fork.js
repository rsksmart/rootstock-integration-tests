const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
  Runners.common.forks.wasabi100,
  () => Runners.hosts.federates
);