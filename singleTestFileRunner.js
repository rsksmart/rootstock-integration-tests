require('dotenv').config();

const shell = require('shelljs');

const testFileNameWithJsExtension = process.argv[2];

const forkName = process.argv[3] || '';

console.log(`Executing test file '${testFileNameWithJsExtension}' in isolation.`);

if(forkName) {
    console.log(`Using fork '${forkName}'.`);
}

// Including this test file to be the only one to be executed
process.env.INCLUDE_CASES = testFileNameWithJsExtension;

// Setting this flag to make the test file know it is being run in isolation and do the necessary adjustments
process.env.RUNNING_SINGLE_TEST_FILE = true;

process.env.FORK_NAME = forkName;

if (shell.exec('npm run test-fail-fast').code !== 0) {
    console.error(`Test file '${testFileNameWithJsExtension}' failed to run.`);
} else {
    console.log(`Test file '${testFileNameWithJsExtension}' ran successfully.`);
}

// Just to make sure we leave everything as we found it
process.env.RUNNING_SINGLE_TEST_FILE = false;

process.env.FORK_NAME = '';
