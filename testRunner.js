require('dotenv').config();
const fs = require('fs').promises;
const shell = require('shelljs');

const defaultParamsValues = {
    clearLogs: false,
    runTestsMultipleTimes: false,
    times: 1,
    runSingleTestFile: false,
    testFileName: '',
    forkName: '',
};

async function deleteAllFiles(directoryPath) {
    try {
      await fs.rm(directoryPath, { recursive: true, force: true });
    } catch (err) {
      console.error(`Error deleting files: ${err.message}`);
    }
};

const getParsedParams = () => {
    const params = process.argv.filter(param => param.startsWith('--'))
    .reduce((params, param) => {
        if(param.startsWith('--clearLogs')) {
            params.clearLogs = true;
        } else if(param.startsWith('--runTestsMultipleTimes')) {
            params.runTestsMultipleTimes = true;
        } else if(param.startsWith('--times')) {
             params.times = param.slice(param.indexOf('=') + 1);
        } else if(param.startsWith('--runSingleTestFile')) {
            params.runSingleTestFile = true;
        } else if(param.startsWith('--testFileName')) {
            params.testFileName = param.slice(param.indexOf('=') + 1);
        } else if(param.startsWith('--forkName')) {
            params.forkName = param.slice(param.indexOf('=') + 1);
        }
        return params;
    }, defaultParamsValues);
    return params;
};

const runTests = async () => {

    const params = getParsedParams();

    if(params.clearLogs) {
        console.log('Clearing logs...');
       await deleteAllFiles(process.env.LOG_HOME);
    }
    
    if(params.runTestsMultipleTimes) {
        const { times } = params;
        return require('./multipleTestExecutionsRunner').runTestsMultipleTimes({ times });
    }
    
    if(params.runSingleTestFile) {
        const { testFileName, forkName } = params;
        return require('./singleTestFileRunner').runSingleTestFile({ testFileName, forkName });
    }

    if (shell.exec('npm run test-fail-fast').code !== 0) {
        console.error(`Tests failed to run.`);
    } else {
        console.info(`Tests ran successfully.`);
    }
    
};

runTests();
