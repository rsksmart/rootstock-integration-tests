const activateForkTest = require('../lib/tests/activate-fork');

// Skipped activate-fork.js. When there is a new fork to be tested pre and post, unskip it in the activate-fork.js file
activateForkTest.execute(
    Runners.common.forks.lovell700
);
