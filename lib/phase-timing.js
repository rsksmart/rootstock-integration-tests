/*
 * Per-phase timing instrumentation for the RIT suite.
 *
 * The whole suite runs inside one opaque `docker run` step in CI, so the GitHub Actions step
 * timing can't tell node-boot/mining from actual test execution. This module records that
 * breakdown from inside the run and writes reports/phase-timing.json, which
 * scripts/ci-timing-summary.js renders into the run summary. That setup-vs-test split is the
 * signal the sharding work (P2-01/P2-02) needs to know where the ~40-min wall-clock goes.
 *
 * Requiring this module self-registers root mocha hooks; the caller (test.js) additionally
 * brackets the initial-block mining with mark('mineStart')/mark('mineEnd'). Everything here is
 * best-effort: it must never throw into the suite, so all bookkeeping is guarded and the file
 * is written from a process 'exit' handler (which also runs on mocha's bail/early exit).
 */

const fs = require('node:fs');
const path = require('node:path');

const marks = {};

const now = () => Date.now();

// Record a named timestamp. Safe to call before/after the hooks below have run and safe to
// call more than once (last write wins); never throws.
const mark = (name) => {
    try {
        marks[name] = now();
    } catch {
        // Timing is diagnostic only — never let it disturb the run.
    }
};

const seconds = (from, to) =>
    marks[from] != null && marks[to] != null ? (marks[to] - marks[from]) / 1000 : null;

const writePhaseTiming = () => {
    try {
        // CI/container-only reporting: GITHUB_WORKSPACE is set on the runner and in the action
        // container (where it is the mounted dir the report reaches the host through). Skipping
        // it otherwise keeps a plain local `npm test` from leaving an untracked reports/ file.
        const base = process.env.GITHUB_WORKSPACE;
        if (!base) {
            return;
        }
        marks.teardownEnd = now();
        const dir = path.join(base, 'reports');
        fs.mkdirSync(dir, { recursive: true });

        const data = {
            setupSeconds: seconds('suiteStart', 'setupEnd'),
            mineSeconds: seconds('mineStart', 'mineEnd'),
            testsSeconds: seconds('setupEnd', 'lastTestEnd'),
            teardownSeconds: seconds('lastTestEnd', 'teardownEnd'),
            totalSeconds: seconds('suiteStart', 'teardownEnd'),
        };
        fs.writeFileSync(path.join(dir, 'phase-timing.json'), JSON.stringify(data, null, 2));
    } catch {
        // Best-effort: a failed write must not affect the test result.
    }
};

// Start the "setup" clock at module load. This module is required at the top of test.js, so
// this runs before the test-file requires and the suite's own setup `before` — so setupSeconds
// includes suite bootstrap, not just the `before` hook. (Node/mocha startup before this require
// is still excluded; the "setup" label is scoped accordingly.)
mark('suiteStart');

// Root hooks give us suiteStart -> (mine) -> setupEnd -> lastTestEnd -> teardownEnd without
// depending on hook ordering relative to the suite's teardown (the file is written on exit).
if (typeof before === 'function') {
    // First test to run marks the end of the one-time setup phase.
    beforeEach(function () {
        if (marks.setupEnd == null) {
            mark('setupEnd');
        }
    });
    // Updated after every test; after the last one it holds the end-of-tests timestamp.
    afterEach(() => mark('lastTestEnd'));
}

process.on('exit', writePhaseTiming);

module.exports = { mark };
