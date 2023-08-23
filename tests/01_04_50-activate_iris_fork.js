const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.iris300,
    () => Runners.hosts.federates
);
