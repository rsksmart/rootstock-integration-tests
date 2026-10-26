#!/usr/bin/env node
/**
 * Runner for the manual tests.
 *
 * These scenarios live outside `tests/`, so `test.js` never globs them and neither the short nor
 * the long suite picks them up. They are started by hand, one at a time, through this runner.
 *
 * Usage:
 *   npm run test-manual                  lists the available scenarios
 *   npm run test-manual <scenario>       runs one
 */
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const MANUAL_TESTS_DIR = __dirname;
const REPO_ROOT = path.resolve(MANUAL_TESTS_DIR, '..');
const SCENARIO_MANIFEST_FILE = 'scenario.js';

// Files whose name starts with a number are the scenario's specs, in the order they are numbered,
// matching the convention under `tests/`. Everything else in the folder is support code.
const SPEC_FILE_PATTERN = /^\d+-.*\.js$/;

// A scenario can run for hours, so the default is far longer than the main suite's 20 minutes.
// A scenario can lower or raise it through its manifest.
const DEFAULT_TIMEOUT_IN_MILLISECONDS = 4 * 60 * 60 * 1000;

const listScenarioNames = () =>
    fs
        .readdirSync(MANUAL_TESTS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) =>
            fs.existsSync(path.join(MANUAL_TESTS_DIR, entry.name, SCENARIO_MANIFEST_FILE))
        )
        .map((entry) => entry.name)
        .sort();

const loadScenario = (scenarioName) => {
    const scenarioDir = path.join(MANUAL_TESTS_DIR, scenarioName);
    const manifest = require(path.join(scenarioDir, SCENARIO_MANIFEST_FILE));

    const specFiles = fs
        .readdirSync(scenarioDir)
        .filter((fileName) => SPEC_FILE_PATTERN.test(fileName))
        .sort()
        .map((fileName) => path.join(scenarioDir, fileName));

    return { ...manifest, name: scenarioName, dir: scenarioDir, specFiles };
};

const printAvailableScenarios = () => {
    const scenarioNames = listScenarioNames();
    if (scenarioNames.length === 0) {
        process.stderr.write(`No scenarios found in ${MANUAL_TESTS_DIR}\n`);
        return;
    }
    process.stdout.write('Available scenarios:\n\n');
    for (const scenarioName of scenarioNames) {
        const { description } = loadScenario(scenarioName);
        process.stdout.write(`  ${scenarioName}${description ? ` - ${description}` : ''}\n`);
    }
    process.stdout.write('\nRun one with: npm run test-manual <scenario>\n');
};

const run = () => {
    const requestedScenarioName = process.argv[2];

    if (!requestedScenarioName) {
        process.stdout.write('No scenario given.\n\n');
        printAvailableScenarios();
        process.exit(1);
    }

    if (!listScenarioNames().includes(requestedScenarioName)) {
        process.stderr.write(`Unknown scenario '${requestedScenarioName}'.\n\n`);
        printAvailableScenarios();
        process.exit(1);
    }

    const scenario = loadScenario(requestedScenarioName);

    if (scenario.specFiles.length === 0) {
        process.stderr.write(
            `Scenario '${scenario.name}' has no spec files. Spec file names start with a number, e.g. 01-something.js\n`
        );
        process.exit(1);
    }

    const timeoutInMilliseconds = scenario.timeoutInMilliseconds || DEFAULT_TIMEOUT_IN_MILLISECONDS;

    const scenarioEnvironment = {
        ...process.env,
        MANUAL_TEST_SCENARIO: scenario.name,
    };
    // A scenario brings its own node configuration, which the bootstrap reads the same way
    // `test.js` reads `CONFIG_FILE_PATH`.
    if (scenario.configFile) {
        scenarioEnvironment.CONFIG_FILE_PATH = path.resolve(scenario.dir, scenario.configFile);
    }

    process.stdout.write(`\nRunning manual scenario '${scenario.name}'\n`);
    if (scenario.description) {
        process.stdout.write(`${scenario.description}\n`);
    }
    process.stdout.write(
        `Timeout: ${timeoutInMilliseconds} ms. Specs: ${scenario.specFiles.map((specFile) => path.basename(specFile)).join(', ')}\n\n`
    );

    // The spec reporter only: the repository's `.mocharc.json` also writes `reports/junit.xml`,
    // which belongs to the CI suite and should not be overwritten by a manual run.
    const mochaArguments = [
        '--timeout',
        String(timeoutInMilliseconds),
        '--reporter',
        'spec',
        ...(scenario.bootstrapFile
            ? ['--file', path.resolve(scenario.dir, scenario.bootstrapFile)]
            : []),
        ...scenario.specFiles,
    ];

    const mochaResult = childProcess.spawnSync(
        path.join(REPO_ROOT, 'node_modules', '.bin', 'mocha'),
        mochaArguments,
        { stdio: 'inherit', cwd: REPO_ROOT, env: scenarioEnvironment }
    );

    if (mochaResult.error) {
        process.stderr.write(`Could not start mocha: ${mochaResult.error.message}\n`);
        process.exit(1);
    }

    process.exit(mochaResult.status === null ? 1 : mochaResult.status);
};

run();
