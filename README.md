# Rootstock Integration tests

[![CodeQL](https://github.com/rsksmart/rootstock-integration-tests/workflows/CodeQL/badge.svg)](https://github.com/rsksmart/rootstock-integration-tests/actions?query=workflow%3ACodeQL)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/rsksmart/rootstock-integration-tests/badge)](https://scorecard.dev/viewer/?uri=github.com/rsksmart/rootstock-integration-tests)

## Disclaimer

This library is intended to be used for testing purposes only, to avoid any possible risk it is recommended to execute in an isolated environment such as a container or VM.

All private keys used in the library are for testing only and not used in any production environment.

## Prerequisites

### bitcoind
- download
  Current pipeline in jenkins is running bitcoind 0.17, 0.18.1 works for local execution.
  - Go to https://bitcoin.org/en/release/v0.18.1 in this page there is the link to the download sources
  https://bitcoincore.org/bin/bitcoin-core-0.18.1/
  Select the *.tar.gz file according to your OS (for MacOS sillicon [bitcoin-0.18.1-osx64.tar.gz](https://bitcoincore.org/bin/bitcoin-core-0.18.1/bitcoin-0.18.1-osx64.tar.gz))
    to use curl instead use `curl -O https://bitcoin.org/bin/bitcoin-core-0.18.1/bitcoin-0.18.1-osx64.tar.gz`
  - Decompress and copy the path to the folder.
  - run in terminal `sudo cp <path to bitcoin-core folder>/bin/bitcoin* /usr/local/bin`
  - create a folder called bitcoindata in your workspace - this is the folder were the Bitcoin DB is going to be stored.
  - run to test the bitcoind installation standalone `bitcoind -deprecatedrpc=generate -addresstype=legacy -regtest -printtoconsole -server -rpcuser=rsk -rpcpassword=rsk -rpcport=18332 -txindex -datadir=<path to bitcoindata> $@`

### Federate node setup
- install java the x86 version to be used with rossetta in case of ARM arch (1.8, 11 and 17 can be used).
- A fatjar of the federate node can be used or follow the setup steps in the powpeg-node to run from scratch.


### HSM 
- Clone the HSM repository https://github.com/rootstock/hsm
- Install python 2.7.16 from the python official site https://www.python.org/downloads/release/python-2716/
- In terminal execute
  - `pip install wheel`
  - `pip install --no-cache secp256k1==0.13.2` (last version 0.14.0 is not working correctly with python 2)
  - test the hsm1 by executing `python fedhm-mockup.py`
  - follow the readme in hsm repository for hsm2 config.

  The pipeline uses the same configuration as in `regtest.js` 
  There is a `regtest.js.sample.hsm1only` that can be set as `regtest.js` to avoid usage of hsm2 if required.
### NODE.JS
- Install node.js latest LTS version (recommendation use [nvm](https://formulae.brew.sh/formula/nvm))

### OPTIONAL (LOGS)

In order to keep a log of each federate node a logback can be setup from the `regtest.js` file per each federate.
There is sample in the logbacks folder that can be copied into each of the federate nodes.
The sample name is `logback-fed1.xml.sample` and inside the change is in the line
```
<file>/PATH/TO/LOGS/fed1.log</file>
```
to determine where the logs are going to be written.
Inside the `regtest.js` file the logbacks per federate node can be setup and mapped as
```
const federatesLogbackPath = '/PATH/TO/logbacks/'
const customLogbackFile1 = federatesLogbackPath + 'logback-fed1.xml';
const customLogbackFile2 = federatesLogbackPath + 'logback-fed2.xml';
const customLogbackFile3 = federatesLogbackPath + 'logback-fed3.xml';
const customLogbackFile4 = federatesLogbackPath + 'logback-fed4.xml';
const customLogbackFile5 = federatesLogbackPath + 'logback-fed5.xml';
``` 
(The names of the logback files are suggestions)

## Running the tests

1. Clone this repo.
2. Run `npm ci`.
3. Generate a configuration for a standalone execution:
  - Copy the sample: `cp config/regtest.js.sample config/regtest.js`
  - Set `federate.classpath` to your local federate node fatjar. Additionally you can set `federate.configFile` to your local configuration files, if you need to test special conditions or your configuration files are located in a different path.
  - Set `federate.hsmConfigs.serverPath` to your local HSM emulator script.
  - Optionally specify `federate.hsmConfigs.keyPath` to your local keys, if you happen to be testing different keys or your keys are located in a different path.
4. Run `npm test` to run testcases without interruption or `npm run test-fail-fast` to stop execution at first testcase failure.
  
### Notes for regtest
- `regtest.js` by default has the following mapping:
    - federate1: key file (no hsm)
    - federate2 and federate3: hsm1
    - federate4 and federate5: hsm2 (modify using the same logic that in federate2 and 3 for changing to hsm1 in case of hsm2 not working as explained in the HSM setup section).


## Running the tests with a different configuration file

1. Create a configuration file, e.g., `config/anotherconfig.js`.
2. Run `NODE_ENV=anotherconfig npm test`.

## Including/Excluding test cases

Follow normal instructions as described before, replacing step 4 with either:

a. `INCLUDE_CASES=file1,file2 npm test`

which will only test files under `tests` that begin with either `file1` or `file2`.

or

b. `EXCLUDE_CASES=file3,file4 npm test`

which will test everything under `tests` except for test scripts that begin with either `file3` or `file4`.

### Important notice

The test 015 works as a fork test and at the same time is required for the subsequent tests, as it enables the whitelisting HF.
If you are going to run a test that uses whitelisting (020,030,040,050 ATM) make sure to include the case 015 in your custom run.

## Running the tests on an existing running bitcoind and/or federate node(s)

1. Copy the sample: `cp config/regtest.js.sample config/mynewenv.js`
2. If you want to run your own bitcoin node, delete the `btc` section and set `mineInitialBitcoin` to `false`. Then add a `runners.bitcoin` section and set the entries `host`, `rpcUser` and `rpcPassword` with the information of your locally running bitcoin node. For example:

```
runners {
  ...,
  bitcoin: {
    host: '127.0.0.1:18332',
    rpcUser: 'myuser',
    rpcPassword: 'mypassword'
  },
  ...
},
...
```

3. If you want to run one or more of your own federate nodes, add a section `runners.federates` with an array of manually started nodes. Each of these must have: `host` and `publicKeys` with the RPC host and public keys of the already running node, respectively. You can still keep automatically started federate nodes if you want to. Then, you can mix manually and automatically started nodes for e.g. debugging. For example:

```
runners {
  ...,
  federates: [{
    host: '127.0.0.1:5555',
    publicKeys: {
      btc: '02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
      rsk: '02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
      mst: '02cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1',
    },
    nodeId: '62634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e87'
  }, {
    host: '127.0.0.1:6666',
    publicKeys: {
      btc: '031da807c71c2f303b7f409dd2605b297ac494a563be3b9ca5f52d95a43d183cc5',
      rsk: '031da807c71c2f303b7f409dd2605b297ac494a563be3b9ca5f52d95a43d183cc5',
      mst: '031da807c71c2f303b7f409dd2605b297ac494a563be3b9ca5f52d95a43d183cc5',
    },
    nodeId: '72634ab57dae9cb373a5d536e76a8c4f67468bbcfb063809bab643072d78a1243bd206c2c7a218d6ff4c9a185e71f066bd354e5267875b7683fbc70a1d455e84'
  }],
  ...
},
...
```

4. Run the tests on the `mynewenv` environment like so:

```
NODE_ENV=mynewenv npm test
```

## Configurations

The runners will override certain configurations.
**Be aware that if you modify your config files for each of these entries it will be ignored and overriden by the runners. This doesn't apply for the node you run on your own.**
Some of them are listed below:

* General configurations. We will send the command argument `--regtest` to use the default regtest configurations for the node.
* Miner. the node miner will be disabled by manual configuration to let the test mine manually using evm_mine.
* Signers. Using the configuration from each federate node we will decide whether we need or not to start HSM signers. Additionally we will override the signer's configuration on each node. See [here](#using-hsm) for more details about HSM specific configurations. If you don't have/want to use HSM, use [this guide](#not-using-hsm) instead.
* RPC port. The port used for RPC communication will be overriden using a tool to detect available ports (between 30000 and 30100)
* Peer port. Same as RPC port, we are using the same port range to get available ports.

### Important information regarding config files

One of the settings in regtest.js `nodeId` MUST match the value for each node in its corresponding config file. You can find this value under `peer`.
The config file will have at least 2 values under `peer`:
* nodeId: just for reference, to be used in the regtest.js configuration.
* privateKey: the value that the node will use to obtain the corresponding `nodeId` and `publicKey`.
It's important to note that both `nodeId` and `privateKey` must be in sync, or else the integration test will fail.

### Using HSM

There is a specific section in each federate element to determine how to start the HSM signer.
```
hsmConfigs: {
  version: '1',
  keyPath: '../configs/keys/reg1.key',
  serverPath: '/your-path-to-hsm-source-code/simulator/fedhm-mockup.py',
  port: '9999'
  printOutput: true
}
```

* version: indicates which version of HSM should be used. By default uses '1'. Accepted values are: 1, 2, 2_stateless (this version is just temporary required and will be removed in the future).
* keyPath: only needed if you are using the mockup or the emulator. The format of this file depends on the version of the HSM used.
* serverPath: path to the source code of the HSM signer.
* port: only needed if you want to use a fixed port. By default it will try to get a free port from the range 40000 to 40100.
* printOutput: enables/disables the specific output of the HSM server.

#### keyPath for HSM 2
The emulator expects to receive a valid JSON file that must respect the following format:
```
{
  "m/44'/1'/0'/0/0": "PRIVATE_KEY",
  "m/44'/1'/0'/0/1": "PRIVATE_KEY",
  "m/44'/1'/0'/0/2": "PRIVATE_KEY"
}
```
These derivation paths correspond to the following key ids:
```
BTC key id - m/44'/1'/0'/0/0
RSK key id - m/44'/1'/0'/0/1
MST key id - m/44'/1'/0'/0/2
```

### Not using HSM

If you don't want to use HSM you can fallback to keyfile signer. To do this you will have to do three things:
1. delete/comment the hsmConfigs section in your federate elements.
2. override the default config file settings to use keyfile.
3. add `publicKeys` config with each key type (`btc`, `rsk` and `mst`). This is required due to key control and federation change testing (the latter only for non-genesis federate members). The public key must be obtained deriving it from the private key specified in the config files (see #2). If you don't know how to calculate it, you can use this website [www.bitaddress.org](https://www.bitaddress.org) going directly to the wallet details tab and copy/pasting the private key there. The value you want is the public key compressed.

To override the settings you have two ways:
* Go directly to the config file and replace the signer section of the federator to match the following:
```
signers {
  BTC {
    type = "keyFile"
    path = "/path-to-utilities/configs/keys/reg1-btc.key"
  }
  RSK {
    type = "keyFile"
    path = "/path-to-utilities/configs/keys/reg1-rsk.key"
  }
}
```
* Specify a custom config that overrides the original config. To do so you would have to add a customConfig element in the federate elements as follows:
```
customConfig: {
  'federator.signers.BTC.type': 'keyFile',
  'federator.signers.BTC.path': '/path-to-utilities/configs/keys/reg1-btc.key',
  'federator.signers.BTC.type': 'keyFile',
  'federator.signers.BTC.path': '/path-to-utilities/configs/keys/reg1-rsk.key'
}
```

Both ways are valid, but keep in mind that the config files are controlled by git so make sure to avoid pushing an unwanted modification.

## Additional considerations

- Run ``` bash configure.sh ``` in order to run ``` chmod 400 ``` to the keys on ``` config/node-keys ```.

- In case ```Sync ``` testcase fails, run command ``` ps aux | grep java ``` and check services. In case of having related processes running, kill them or reboot your system. It could also be related to having an instance of bitcoind running.

## Running the tests multiple times

### Running all tests multiple times from scratch

To run all tests multiple times from scratch, right after all tests finished running, run:

> node testRunner.js

Or with npm:

> npm run run-tests-multiple-times

You can specify how many times to run all tests from scratch by adding the times to run them in the `RUN_ALL_TESTS_THESE_TIMES` property in the `.env` file.

Remember to copy the `.env-example` file and rename it as `.env` file.

Or, you can pass te times you want to run the tests from scratch using the `--times` flag, like this:

> npm run run-tests-multiple-times --times 3

The `npm run run-tests-multiple-times` command is executing the file `testRunner.js`, which uses `shelljs` to execute the script `npm run test-fail-fast` in a loop and counts the failures and print some information to the console.

### Running a specific test file multiple times

To run a specific test file multiple times, include the test file name in the `INCLUDE_CASES` property in the `.env` file, like:

```
INCLUDE_CASES=01_01_01-pre_orchid_2wp.js
```

Then update the `RUN_EACH_TEST_FILE_THESE_TIMES` property in the `.env` file to indicate how many times to run this single file.

Then run the tests as usual:

> npm run test

Or:

> npm run test-fail-fast

*Note*

Remember that with this approach we are not running the test file from scratch every time. Each test run will run in the same instance as the others, meaning, it will use the same `btc` and `rsk` networks with the same state. If you don't want this, then use the approach described above `Running all tests multiple times from scratch`.

To run specific test files from scratch, use the same setup described in this section, and for the script instead run:

> npm run run-tests-multiple-times

This will run specific test files from scratch.

If you set `RUN_EACH_TEST_FILE_THESE_TIMES` to a value greater than 1 and also set `RUN_ALL_TESTS_THESE_TIMES` to a value greater than one at the same time, then the tests files specified in `INCLUDE_CASES` will run `RUN_EACH_TEST_FILE_THESE_TIMES` by `RUN_ALL_TESTS_THESE_TIMES` times, which may not be what you desire. So, remember to only set one of these to a value greater than 1 at a time, or both if you know what you're doing.

Remember to run `...activate_x_fork.js` file if running a file test that depends on an unactivated fork.

For example, if you only wants to run `01_03_54-post-papyrus_coinbase_information.js`, you first need to run `01_03_50-activate_papyrus_fork.js`.

Make sure you have enough memory before running the tests, close unnecessary projects and apps. Sometimes the fits cannot build properly if it doesn't have enough memory.

### Running a single file test

Most of the tests are dependant on some previous state of the blockchain to function properly and thus cannot be run individually.

To fix this, we can have a function called `fulfillRequirementsToRunAsSingleTestFile` in each test file that acts as a utility to make the blockchain be at the state where our test will run properly without depending on other previous tests.

This is useful specially during development that most of the time that we spent adding or updating tests is waiting for all the tests before our test to run.
If our test is one of the last tests, then we will potentially wait more than 15 minutes for the build to reach our test.

To run a test file that has the `fulfillRequirementsToRunAsSingleTestFile` function, simply run the following `npm` command:

> npm run run-single-test-file <filename.js>

For example:

> npm run run-single-test-file 01_02_51-post_wasabi_fed_pubkeys_fork.js

The command `run-single-test-file` will execute the file `singleTestFileRunner.js` which has some simple logic:

1 - It will assign the `01_02_51-post_wasabi_fed_pubkeys_fork.js` test file name to the `process.env.INCLUDE_CASES` variable. Since it will be the one in that `INCLUDE_CASES` variable, then only that test file will be run.

2 - It will setup a boolean `process.env.RUNNING_SINGLE_TEST_FILE` variable to `true` so the `fulfillRequirementsToRunAsSingleTestFile` function can check if it needs to manually take the blockchain to a state where the test file can run or not.
