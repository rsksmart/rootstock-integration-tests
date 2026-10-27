/**
 * Checks on the harness itself, rather than on anything it runs.
 *
 * These are cheap and structural: no nodes, no network, a few readdir calls. `run.js` runs them
 * before every invocation, so a harness that has quietly stopped working is caught at the moment
 * somebody tries to use it rather than whenever a person remembers to look. The `harness-check`
 * scenario asserts the same function, which is how they get exercised on their own.
 */
const fs = require('node:fs');
const path = require('node:path');

const MANUAL_TESTS_DIR = path.resolve(__dirname, '..');
const MAIN_SUITE_TESTS_DIR = path.resolve(MANUAL_TESTS_DIR, '..', 'tests');

const SCENARIO_MANIFEST_FILE = 'scenario.js';

// Files whose name starts with a number are a scenario's specs, in the order they are numbered,
// matching the convention under `tests/`. Everything else in the folder is support code.
const SPEC_FILE_PATTERN = /^\d+-.*\.js$/;

// Directories under manual-tests/ that are deliberately not scenarios: shared code, and the
// scratch directory the scenarios write keyfiles and chain data into. Anything else with no
// manifest is a mistake, which is what the checks below are for.
const NON_SCENARIO_DIRECTORIES = ['lib', 'generated'];

/**
 * The directories under manual-tests/ that are meant to be scenarios.
 * @returns {Array<string>}
 */
const getScenarioDirectoryNames = () => {
    return fs
        .readdirSync(MANUAL_TESTS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .filter((directoryName) => !NON_SCENARIO_DIRECTORIES.includes(directoryName))
        .sort();
};

/**
 * Everything wrong with the harness, as sentences a person can act on.
 * @returns {Array<string>} empty when the harness is sound
 */
const findHarnessProblems = () => {
    const problems = [];

    // `test.js` registers './tests/**/*.js'. Everything under manual-tests/ has to stay outside
    // that glob, or the regular suite starts running scenarios that take hours.
    const pathFromMainSuiteTests = path.relative(MAIN_SUITE_TESTS_DIR, MANUAL_TESTS_DIR);
    if (!pathFromMainSuiteTests.startsWith('..')) {
        problems.push(
            `manual-tests/ resolves inside tests/ (${pathFromMainSuiteTests}), so the regular suite would pick these scenarios up`
        );
    }

    const scenarioDirectoryNames = getScenarioDirectoryNames();
    if (scenarioDirectoryNames.length === 0) {
        problems.push(`No scenario folders found in ${MANUAL_TESTS_DIR}`);
    }

    for (const scenarioDirectoryName of scenarioDirectoryNames) {
        const scenarioDir = path.join(MANUAL_TESTS_DIR, scenarioDirectoryName);

        if (!fs.existsSync(path.join(scenarioDir, SCENARIO_MANIFEST_FILE))) {
            problems.push(
                `Scenario '${scenarioDirectoryName}' has no ${SCENARIO_MANIFEST_FILE}, so the runner will not list it`
            );
            continue;
        }

        const specFileNames = fs
            .readdirSync(scenarioDir)
            .filter((fileName) => SPEC_FILE_PATTERN.test(fileName));
        if (specFileNames.length === 0) {
            problems.push(
                `Scenario '${scenarioDirectoryName}' has no spec files. Spec file names start with a number, e.g. 01-something.js`
            );
        }
    }

    return problems;
};

module.exports = {
    MANUAL_TESTS_DIR,
    SCENARIO_MANIFEST_FILE,
    SPEC_FILE_PATTERN,
    getScenarioDirectoryNames,
    findHarnessProblems,
};
