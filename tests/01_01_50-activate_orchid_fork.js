const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.orchid,
    () => Runners.hosts.federates
);