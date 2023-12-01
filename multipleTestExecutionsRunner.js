require('dotenv').config();

const shell = require('shelljs');

const timesArg = Number(process.argv[2]);

const RUN_ALL_TESTS_THESE_TIMES = timesArg || Number(process.env.RUN_ALL_TESTS_THESE_TIMES) || 1;

console.info(`Will attempt to run tests ${RUN_ALL_TESTS_THESE_TIMES} times.`);

const cleanEnvCommand = "kill $(ps -A | grep -e java -e python -e bitcoind | awk '{print $1}')";

const ensureCleanEnv = () => {
    console.info('Cleaning environment...');
    shell.exec(cleanEnvCommand);
    console.info('Environment clean.');
};

let fails = 0;
let attempts = 1;

for(let i = 0; i < RUN_ALL_TESTS_THESE_TIMES; i++) {
    console.info(`Running tests ${attempts} out of ${RUN_ALL_TESTS_THESE_TIMES} times.`);
    ensureCleanEnv();
    if (shell.exec('npm run test-fail-fast').code !== 0) {
        fails++;
    }
    console.info(`Tests have failed ${fails} times so far.`);
    console.info(`Tests have passed ${attempts - fails} times so far.`);
    attempts++;
}

console.info(`Tests failed ${fails} times out of ${RUN_ALL_TESTS_THESE_TIMES} attempts.`);
