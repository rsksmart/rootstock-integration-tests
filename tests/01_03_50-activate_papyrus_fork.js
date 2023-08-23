const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.papyrus200,
    () => Runners.hosts.federates
);
