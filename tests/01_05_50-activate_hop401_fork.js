const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.hop401,
    () => Runners.hosts.federates
);
