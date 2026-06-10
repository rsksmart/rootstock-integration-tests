# Rootstock Integration tests

[![CodeQL](https://github.com/rsksmart/rootstock-integration-tests/workflows/CodeQL/badge.svg)](https://github.com/rsksmart/rootstock-integration-tests/actions?query=workflow%3ACodeQL)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/rsksmart/rootstock-integration-tests/badge)](https://scorecard.dev/viewer/?uri=github.com/rsksmart/rootstock-integration-tests)

## Disclaimer

This library is intended to be used for testing purposes only, to avoid any possible risk it is recommended to execute in an isolated environment such as a container or VM.

All private keys used in the library are for testing only and not used in any production environment.

## Flyover compatibility (LPS × LBC)

Source of truth for which [Liquidity Provider Server (LPS)](https://github.com/rsksmart/liquidity-provider-server) and [Liquidity Bridge Contract (LBC)](https://github.com/rsksmart/liquidity-bridge-contract) versions work together on **split-contract** Flyover (PegIn, PegOut, FlyoverDiscovery, CollateralManagement).

- **Config:** [`compat/lps-lbc-matrix.yaml`](compat/lps-lbc-matrix.yaml) — pairs, refs, and smoke tests for `compat:matrix` / `compat:check`
- **PoC scope:** 2×2 — LPS `QA-Test`, `master` × LBC `QA-Test`, `master`
- **Out of scope:** legacy monolithic `LBC_ADDR`, cross-major pairs — see [LP Migration Utilities](https://github.com/rsksmart/liquidity-provider-server/blob/master/docs/LP-Migration-Utils.md)

LPS needs split-contract addresses: `PEGIN_CONTRACT_ADDRESS`, `PEGOUT_CONTRACT_ADDRESS`, `DISCOVERY_ADDRESS`, `COLLATERAL_MANAGEMENT_ADDRESS`.

### Declared matrix

| LPS \ LBC | [QA-Test](https://github.com/rsksmart/liquidity-bridge-contract/tree/QA-Test) | [master](https://github.com/rsksmart/liquidity-bridge-contract/tree/master) |
|-----------|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| [QA-Test](https://github.com/rsksmart/liquidity-provider-server/tree/QA-Test) | **Supported** | Not tested |
| [master](https://github.com/rsksmart/liquidity-provider-server/tree/master) | Not tested | Not tested |

| Status | Meaning |
|--------|---------|
| **Supported** | Declared safe for split-contract deployments |
| **Not tested** | In scope; not yet smoke-validated |
| **Unsupported** | Known incompatible |

### Local validation

| Command | What it does |
|---------|----------------|
| `npm run compat:matrix` | All 4 pairs; grid: **green** = all smokes pass, **orange** = some pass, **red** = none pass |
| `npm run compat:check` | Single pair (default QA-Test × QA-Test) |
| `npm run compat:check -- <lbc-ref> <lps-ref>` | Custom pair (LBC ref first, then LPS) |

```bash
npm run compat:matrix
npm run compat:check
npm run compat:check -- master master
npm run compat:check -- master QA-Test

# Smoke only (stack already running)
./scripts/run-lps-lbc-compat-check.sh --skip-lps-up
```

**Prerequisites:** Docker, Git, Node.js, npm; LPS and LBC clones at `../liquidity-provider-server` and `../liquidity-bridge-contract`.

Each full run: (1) `git fetch` + detached checkout at `origin/<ref>` in LPS and LBC (logged SHA, no patches to tracked source), (2) deploy — `compat:matrix` cleans Docker volumes per cell, then `lps-env.sh up` (or `lps-local.sh` on newer LPS branches), (3) smoke — [`01_08_00`](tests/01_08_00-flyover_split_contracts_smoke.js) and [`01_08_01`](tests/01_08_01-flyover_sdk_smoke.js) via [`config/regtest-external-lps-smoke.js`](config/regtest-external-lps-smoke.js).

| Option | Default | Description |
|--------|---------|-------------|
| `--lps-ref` / `--lbc-ref` | `QA-Test` | Matrix label; checked out as `origin/<ref>` |
| `--skip-lps-up` | off | Skip deploy; expect stack running |
| `--clean-before-up` | off (on in matrix) | Wipe bind-mount volumes before deploy |
| `--start-existing` | off | Start stopped containers without pulls |
| `--smoke-tests` | from YAML | Comma-separated test prefixes (override matrix default) |

| Issue | Action |
|-------|--------|
| `chown: Operation not permitted` (WSL) | Use `compat:matrix` or `--clean-before-up` |
| LPS health timeout | `docker logs lps01`; try `--start-existing` |
| Deploy failed, 0 smokes run | See cell **Details** in matrix summary |
| Wrong pair tested | Use full `compat:check` / `compat:matrix`, not `--skip-lps-up` |

To update: edit [`compat/lps-lbc-matrix.yaml`](compat/lps-lbc-matrix.yaml) and the declared matrix table above; after a green run, add validation notes in the YAML (e.g. `validated: rit-smoke-2026-06-09`).

## Prerequisites

### bitcoind

- download
  Current Github Actions job is running bitcoind 0.18.1.
  - Go to https://bitcoin.org/en/release/v0.18.1 in this page there is the link to the download sources
  https://bitcoincore.org/bin/bitcoin-core-0.18.1/
  Select the *.tar.gz file according to your OS (for MacOS silicon [bitcoin-0.18.1-osx64.tar.gz](https://bitcoincore.org/bin/bitcoin-core-0.18.1/bitcoin-0.18.1-osx64.tar.gz))
    to use curl instead use `curl -O https://bitcoin.org/bin/bitcoin-core-0.18.1/bitcoin-0.18.1-osx64.tar.gz`
  - Decompress and copy the path to the folder.
  - run in terminal `sudo cp <path to bitcoin-core folder>/bin/bitcoin* /usr/local/bin`
  - create a folder called bitcoindata in your workspace - this is the folder were the Bitcoin DB is going to be stored.
  - run to test the bitcoind installation standalone `bitcoind -deprecatedrpc=generate -addresstype=legacy -regtest -printtoconsole -server -rpcuser=rsk -rpcpassword=rsk -rpcport=18332 -txindex -datadir=<path to bitcoindata> $@`

### Federate node setup

- Install java the x86 version to be used with Rosetta in case of ARM arch (1.8, 11 and 17 can be used).
- A fatjar of the federate node can be used or follow the setup steps in the powpeg-node to run from scratch. Check: https://github.com/rsksmart/powpeg-node/blob/master/README.md

### NODE.JS
- Install node.js latest LTS version (recommendation use [nvm](https://formulae.brew.sh/formula/nvm))

## Initial Configuration using .env file

After cloning this project and `cd` to it, you can make a copy to the `.env-example` file and rename it `.env` and setup the environment variables that you need.

You will need to provide values for most these variables:

```
POWPEG_NODE_JAR_PATH=/Users/<your_user>/repos/powpeg-node/build/libs/federate-node-SNAPSHOT-<version>all.jar
CONFIG_FILE_PATH=./config/regtest-all-keyfiles
LOG_HOME=/Users/<your_user>/config/logs-config
BITCOIND_BIN_PATH=/Users/<your_user>/bitcoind/bin/bitcoind
JAVA_BIN_PATH=/Library/Java/JavaVirtualMachines/adoptopenjdk-17.jdk/Contents/Home/bin/java
BITCOIN_DATA_DIR=/Users/<your_user>/bitcoin-data
```

There are more variables in the `.env-example` files, but they already have default values and are a bit less important. You can find more details about them in th e`.env-example` file and there is a section dedicated them below in this document.

`POWPEG_NODE_JAR_PATH` should point to the absolute path of the powpeg-node .jar file in your system to be executed.

You can leave this value as the example or set `CONFIG_FILE_PATH` to the actual path of the configuration file you are going to use. If you don't provide a value, it will try to use `./config/regtest-all-keyfiles.js` instead.
Notice that there is a `regtest-all-keyfiles.js` file in the `config` directory. You can either use that one, rename it, modify it or use a new one.

### Running the tests using the Tcp Signer

At the moment, we are running the tests with `keyfiles` nodes by default. If you want to run the tests with nodes using the tcp signer, then change the value of the `CONFIG_FILE_PATH` environment variable to `./config/regtest-key-files-and-hsms`. Using this configuration file will load one tcp signer instance for each federator that has an `hsm` type.

### Logs

There is one `base-logback-config.xml` file in the `config` directory. It serves as an example of how the logback configuration files should look.

In the `restest...` files in `config/` directory, each federator node has a reference to a logback configuration file path. By default, if the file doesn't exist in that path, then the setup process will create it automatically.

You can update the `LOG_HOME` environment variable to point to where you have your logback configuration files. If you don't, then they will be created for you automatically at the root directory of this project, in a new `logs/` directory.

The environment variable `LOG_HOME` should point the directory where the logback configurations files are.

### Bitcoind

You you already have `bitcoind` installed in your system, you can leave `BITCOIND_BIN_PATH` empty, the tests will use the one available from the system. If you have the `bitcoind` binaries in a specific directory, you can specify that directory in this variable. This way you don't have to fully install `bitcoind` in your system.

### Java

If you already have the correct `java` version installed in your system, you can leave `JAVA_BIN_PATH` empty, the tests will use the one available from the system. If you have the java binaries in a specific directory, you can specify that directory in this variable.

Set the directory where you want the bitcoin database to be located at here `BITCOIN_DATA_DIR`.

## Running the tests

Make sure to make the `configure.sh` file executable with the command `chmod +x configure.sh`, then execute it like `./configure.sh` so the `keyfiles` nodes can use the private keys specified in the `config/node-keys` directory.

1. Run `npm ci`
2. Run `npm test` to run testcases without interruption
3. Run `npm run test-fail-fast` to stop execution at first testcase failure.

Sometimes after running the tests, some federate nodes stay running in the background and using the assigned port. Also bitcoind can do this.
You might notice this when the `sync` test case fails.
We can use the `cleanEnv.js` file to stop these services and also clean the logs files.

Simply run:

> sudo node cleanEnv.js

## Running the tests with a different configuration file

1. Create a configuration file, e.g., `config/another_config.js`.
2. Run `CONFIG_FILE_PATH=path_to_another_config_file npm test` or simply set the `CONFIG_FILE_PATH` value in the `.env` file.

## Flyover smoke tests (optional)

The `01_08_00` and `01_08_01` tests run automatically via `npm run compat:check` / `compat:matrix` (see above). To run them manually against an already-running LPS stack, they are skipped by default when required env vars are unset, so the main integration suite is unaffected.

**Prerequisites**

1. A running LPS and deployed split contracts (pegin, pegout, discovery, collateral management).
2. Optionally set `CONFIG_FILE_PATH=./config/regtest-external-lps-smoke` when using a
   pre-running federate node and bitcoind instead of the default RIT runners.

**Required environment variables**

| Variable | Description |
|---|---|
| `FLYOVER_LPS_URL` | Base URL of the LPS (e.g. `http://127.0.0.1:8080`) |
| `PEGIN_CONTRACT_ADDRESS` | Deployed pegin contract address |
| `PEGOUT_CONTRACT_ADDRESS` | Deployed pegout contract address |
| `DISCOVERY_ADDRESS` | Deployed discovery contract address |
| `COLLATERAL_MANAGEMENT_ADDRESS` | Deployed collateral management contract address |

**Optional environment variables**

| Variable | Default | Description |
|---|---|---|
| `FLYOVER_PROVIDER_ID` | first provider | LPS provider id to use |
| `FLYOVER_RSK_RPC_URL` | `http://127.0.0.1:4444` | RSK RPC endpoint (SDK test) |
| `FLYOVER_SDK_NETWORK` | `Regtest` | Flyover SDK network name |
| `FLYOVER_TEST_DESTINATION_ADDRESS` | test address | Quote destination |
| `FLYOVER_TEST_REFUND_ADDRESS` | test address | Quote refund address |
| `FLYOVER_TEST_VALUE_WEIS` | `1e18` | Quote transfer value in wei |

**Run only the smoke tests**

```bash
INCLUDE_CASES=01_08_00,01_08_01 npm test
```

The SDK smoke test (`01_08_01`) includes a temporary shim that re-points SDK contract
instances to locally deployed split contracts. Remove that shim once SDK regtest constants
match the external LPS deployment.

## Including/Excluding test cases

Follow normal instructions as described before, replacing step 4 with either:

a. `INCLUDE_CASES=file1,file2 npm test`

which will only test files under `tests` that begin with either `file1` or `file2`.

or

b. `EXCLUDE_CASES=file3,file4 npm test`

which will test everything under `tests` except for test scripts that begin with either `file3` or `file4`.

## Running the tests on an existing running bitcoind and/or federate node(s)

Coming soon...

## Running the tests with the TCP Signer

Coming soon...

## Configurations

The runners will override certain configurations.
**Be aware that if you modify your config files for each of these entries it will be ignored and overriden by the runners. This doesn't apply for the node you run on your own.**
Some of them are listed below:

* General configurations. We will send the command argument `--regtest` to use the default regtest configurations for the node.
* Miner. the node miner will be disabled by manual configuration to let the test mine manually using evm_mine.

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

### Running with docker

You can simply run the `npm` command:

> npm run run-with-docker

Running it this way is important. It will read the `.env` variables first to locale the `POWPEG_NODE_JAR_PATH` and copy it here so `Dockerfile` can copy it along with the rest of the project.

Using docker to run the tests you don't have to worry about installing the right version of Java or Bitcoind.

It will also read the `DOCKER_REMOVE_CONTAINER_AFTER_EXECUTION` variable from the `.env` file.

So make sure you have the `.env` file ready. Then, the `Dockerfile` will replace the `.env` file's content with the `.env.docker` file's content.

#### Building the docker image and running the container directly

Building

To build the docker image directly, on the root directory, run:

> docker buildx build --platform linux/amd64 -t rits .

The `--platform linux/amd64` is necessary because the bitcoind binary depends on that platform, or it will fail to run.

Running

To run it, execute:

> docker run --platform linux/amd64 -it rits
