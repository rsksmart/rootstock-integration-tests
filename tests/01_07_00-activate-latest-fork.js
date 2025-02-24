const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.lovell700,
    () => Runners.hosts.federates
);
