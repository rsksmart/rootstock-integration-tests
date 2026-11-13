/**
 * Root level setup and teardown for a manual scenario that runs on one of the regular suite's node
 * configurations: `config/regtest-all-keyfiles.js` (keyfile signers only) or
 * `config/regtest-key-files-and-hsms.js` (federations that also sign with HSMs, through tcpsigner).
 *
 * It reuses the regular suite's root hooks (`test.js`) to start bitcoind and the genesis
 * federation, without registering any of the regular suite's tests, and then mines the blocks the
 * regular suite's first test mines. The regular suite's helpers expect the chain to be past them:
 * a federation change, for one, starts each tcpsigner from a checkpoint ten blocks behind the best
 * block.
 *
 * A scenario names this file in its manifest's `bootstrapFile`, or requires it from its own
 * bootstrap file after setting whatever else it needs.
 */
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('chai');
const rskUtils = require('../../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../../lib/rsk-tx-helper-provider');
const { wait } = require('../../lib/utils');

// What the regular suite's first test (`tests/00_sync/01-sync.js`) waits and mines.
const WAIT_BEFORE_MINING_IN_MILLISECONDS = 5000;
const INITIAL_RSK_BLOCKS = 515;

// `test.js` registers every file under `tests/` that `INCLUDE_CASES` lets through, so it is set to
// a pattern no file there matches.
process.env.INCLUDE_CASES = 'no-regular-suite-test-matches-this';

// bitcoind runs on a fixed data directory, so a run would find the previous run's wallet there.
const config = require(process.env.CONFIG_FILE_PATH);
const bitcoinDataDir = config.btc.dir;
fs.mkdirSync(bitcoinDataDir, { recursive: true });
for (const entry of fs.readdirSync(bitcoinDataDir)) {
    fs.rmSync(path.join(bitcoinDataDir, entry), { recursive: true, force: true });
}

require('../../test.js');

// Registered after the ones in `test.js`, so it runs once bitcoind and the nodes are up.
before(async () => {
    await wait(WAIT_BEFORE_MINING_IN_MILLISECONDS);

    const latestBlockNumbers = await rskUtils.mineAndSync(
        getRskTransactionHelpers(),
        INITIAL_RSK_BLOCKS
    );

    expect(
        latestBlockNumbers,
        `Every federator node should be synched at block ${INITIAL_RSK_BLOCKS}`
    ).to.deep.equal(latestBlockNumbers.map(() => INITIAL_RSK_BLOCKS));
});
