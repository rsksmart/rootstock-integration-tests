const { expect } = require('chai');
const { findHarnessProblems, getScenarioDirectoryNames } = require('../lib/harness-checks');

describe('Manual test harness', function () {
    it('should have been started through the manual test runner', () => {
        expect(
            process.env.MANUAL_TEST_SCENARIO,
            'MANUAL_TEST_SCENARIO is not set. Run this with `npm run test-manual harness-check`, not with mocha directly'
        ).to.equal('harness-check');
    });

    it('should find nothing wrong with the harness', () => {
        // The same checks `run.js` makes before every invocation, which is what keeps them from
        // going stale. Running them here too is how they get exercised deliberately, and gives
        // somebody changing them a place to see them pass or fail on their own.
        expect(findHarnessProblems().join('; ')).to.equal('');
    });

    it('should list the scenarios that exist', () => {
        const scenarioDirectoryNames = getScenarioDirectoryNames();

        expect(scenarioDirectoryNames, 'No scenario folders found').to.not.be.empty;
        expect(
            scenarioDirectoryNames,
            'harness-check should be among the scenarios, since it is the one running'
        ).to.include('harness-check');
    });
});
