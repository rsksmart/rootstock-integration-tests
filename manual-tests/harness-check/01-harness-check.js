const { expect } = require('chai');
const fs = require('node:fs');
const path = require('node:path');

const MANUAL_TESTS_DIR = path.resolve(__dirname, '..');
const MAIN_SUITE_TESTS_DIR = path.resolve(__dirname, '../../tests');
const SCENARIO_MANIFEST_FILE = 'scenario.js';
const SPEC_FILE_PATTERN = /^\d+-.*\.js$/;

// Directories under manual-tests/ that are deliberately not scenarios: shared code, and the
// scratch directory the scenarios write keyfiles and chain data into. Anything else with no
// manifest is a mistake worth catching, which is the point of the check below.
const NON_SCENARIO_DIRECTORIES = ['lib', 'generated'];

const getScenarioDirectoryNames = () =>
    fs
        .readdirSync(MANUAL_TESTS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((directoryName) => !NON_SCENARIO_DIRECTORIES.includes(directoryName));

describe('Manual test harness', function () {
    it('should have been started through the manual test runner', () => {
        expect(
            process.env.MANUAL_TEST_SCENARIO,
            'MANUAL_TEST_SCENARIO is not set. Run this with `npm run test-manual harness-check`, not with mocha directly'
        ).to.equal('harness-check');
    });

    it('should keep the scenarios out of the directory the main suite globs', () => {
        // `test.js` registers './tests/**/*.js'. Everything under manual-tests/ is outside that
        // glob, which is what keeps these scenarios out of both the short and the long suite.
        const pathFromMainSuiteTests = path.relative(MAIN_SUITE_TESTS_DIR, MANUAL_TESTS_DIR);
        expect(
            pathFromMainSuiteTests.startsWith('..'),
            `manual-tests/ resolved inside tests/ (${pathFromMainSuiteTests}), so the main suite would pick these up`
        ).to.be.true;
    });

    it('should give every scenario a manifest and at least one numbered spec file', () => {
        const scenarioDirectoryNames = getScenarioDirectoryNames();

        expect(scenarioDirectoryNames, 'No scenario folders found').to.not.be.empty;

        for (const scenarioDirectoryName of scenarioDirectoryNames) {
            const scenarioDir = path.join(MANUAL_TESTS_DIR, scenarioDirectoryName);

            expect(
                fs.existsSync(path.join(scenarioDir, SCENARIO_MANIFEST_FILE)),
                `Scenario '${scenarioDirectoryName}' has no ${SCENARIO_MANIFEST_FILE}, so the runner will not list it`
            ).to.be.true;

            const specFileNames = fs
                .readdirSync(scenarioDir)
                .filter((fileName) => SPEC_FILE_PATTERN.test(fileName));
            expect(
                specFileNames,
                `Scenario '${scenarioDirectoryName}' has no spec files. Spec file names start with a number, e.g. 01-something.js`
            ).to.not.be.empty;
        }
    });
});
