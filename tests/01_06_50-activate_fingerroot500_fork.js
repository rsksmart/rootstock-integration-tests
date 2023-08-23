const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.fingerroot500,
    () => Runners.hosts.federates
);
