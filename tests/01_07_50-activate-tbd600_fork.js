const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.tbd600,
    () => Runners.hosts.federates
);
