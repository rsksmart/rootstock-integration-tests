require('dotenv').config();
const shell = require('shelljs');

// Just to make sure we leave everything as we found it
process.env.RUNNING_SINGLE_TEST_FILE = false;
process.env.FORK_NAME = '';

const runSingleTestFile = (params) => {

    const { testFileName, forkName = '' } = params;

    if(!testFileName) {
        console.error('No test file name provided.');
        return;
    }

    if(!testFileName.endsWith('.js')) {
        testFileName += '.js';
        return;
    }

    console.info(`Executing test file '${testFileName}' in isolation.`);

    if(forkName) {
        console.info(`Using fork '${forkName}'.`);
    }

    // Including this test file to be the only one to be executed
    process.env.INCLUDE_CASES = testFileName;

    // Setting this flag to make the test file know it is being run in isolation and do the necessary adjustments
    process.env.RUNNING_SINGLE_TEST_FILE = true;

    process.env.FORK_NAME = forkName;

    if (shell.exec('npm run test-fail-fast').code !== 0) {
        console.error(`Test file '${testFileName}' failed to run.`);
    } else {
        console.info(`Test file '${testFileName}' ran successfully.`);
    }

};

module.exports = {
    runSingleTestFile
};
