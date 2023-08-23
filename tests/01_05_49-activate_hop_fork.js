const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.hop400,
    () => Runners.hosts.federates
);
