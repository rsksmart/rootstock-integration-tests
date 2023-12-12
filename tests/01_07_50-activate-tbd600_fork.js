const activateForkTest = require('../lib/tests/activate-fork');

activateForkTest.execute(
    Runners.common.forks.arrowhead600,
    () => Runners.hosts.federates
);
