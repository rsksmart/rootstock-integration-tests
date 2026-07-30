#!/usr/bin/env node
/*
 * CI timing summary — renders the JUnit report (and, when present, the per-phase
 * timing file) as a Markdown table for the GitHub Actions run summary.
 *
 * Usage: node scripts/ci-timing-summary.js [path/to/junit.xml] [path/to/phase-timing.json]
 *
 * Writes Markdown to stdout; the workflow appends it to $GITHUB_STEP_SUMMARY. Designed to
 * never fail the job: missing/unparsable inputs produce a note, not a non-zero exit. The
 * primary consumer of this breakdown is the sharding work (P2-01/P2-02), which needs
 * per-test-file durations to balance shards and to measure wall-clock against the baseline.
 */

const fs = require('node:fs');
const path = require('node:path');

const junitArg = process.argv[2] || 'reports/junit.xml';
const phaseArg = process.argv[3] || 'reports/phase-timing.json';

// Number of rows to show in the "slowest" tables; the full data lives in the artifact.
const TOP_SLOWEST_FILES = 30;
const TOP_SLOWEST_TESTS = 15;

// Behaviour-area tags (P0-02) are authored as a leading block on the top-level describe title,
// e.g. "@smoke @regression @2wp @pegin @pegout BTC <=> RSK 2WP …", so they surface at the start
// of the testcase classname (and, under some reporter configs, name). Matches @word / @kebab-case.
const TAG_TOKEN_RE = /^@[\w-]+/;
const UNTAGGED = '(untagged)';

// Paths come from argv, so guard them before any file-system access: resolve against the
// working directory (which is GITHUB_WORKSPACE in CI, where the reports live) and confirm the
// canonical path stays inside it. The check is kept inline at each use so a crafted argument
// that escapes the base is refused before it ever reaches the file system. realpathSync
// additionally blocks a symlink under the (container-written) reports dir from pointing
// outside the base — BASE_DIR is itself realpath'd so the comparison holds on symlinked roots.
// realpathSync can throw (permissions, broken symlink); fall back to the plain resolved cwd so
// module load never crashes the summary step.
let BASE_DIR;
try {
    BASE_DIR = fs.realpathSync(path.resolve(process.cwd()));
} catch {
    BASE_DIR = path.resolve(process.cwd());
}

const safeExists = (p) => {
    try {
        const resolved = path.resolve(BASE_DIR, p);
        if (resolved !== BASE_DIR && !resolved.startsWith(BASE_DIR + path.sep)) {
            return false;
        }
        if (!fs.existsSync(resolved)) {
            return false;
        }
        const real = fs.realpathSync(resolved);
        return real === BASE_DIR || real.startsWith(BASE_DIR + path.sep);
    } catch {
        // Never let a file-system probe fail the job — treat as "not present".
        return false;
    }
};

const safeRead = (p) => {
    const resolved = path.resolve(BASE_DIR, p);
    if (resolved !== BASE_DIR && !resolved.startsWith(BASE_DIR + path.sep)) {
        throw new Error(`Refusing to access a path outside the workspace: ${p}`);
    }
    const real = fs.realpathSync(resolved);
    if (real !== BASE_DIR && !real.startsWith(BASE_DIR + path.sep)) {
        throw new Error(`Refusing to follow a symlink outside the workspace: ${p}`);
    }
    return fs.readFileSync(real, 'utf8');
};

const out = (line = '') => process.stdout.write(line + '\n');

// Test/suite names are arbitrary strings; a literal `|`, a backtick (which would break a cell
// wrapped in an inline-code span), or a newline would break the Markdown table, so neutralize
// them before writing a cell.
const escapeCell = (str) =>
    String(str)
        .replaceAll('|', '\\|')
        .replaceAll('`', "'")
        .replaceAll(/[\r\n]+/g, ' ');

const fmtDuration = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '—';
    }
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const getAttr = (fragment, name) => {
    const match = fragment.match(new RegExp(String.raw`\b${name}="([^"]*)"`));
    return match ? match[1] : null;
};

const decode = (str) =>
    (str || '')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&');

const CASE_RE = /<testcase\b[^>]*?(?:\/>|>[\s\S]*?<\/testcase>)/g;
const SUITE_RE = /<testsuite\b[^>]*?(?:\/>|>[\s\S]*?<\/testsuite>)/g;

// Fold a single <testcase> into its suite entry and the running totals.
const addTestcase = (caseFragment, suiteName, entry, tests, totals) => {
    const time = Number.parseFloat(getAttr(caseFragment, 'time') || '0') || 0;
    const failed = /<failure\b|<error\b/.test(caseFragment);
    const skipped = /<skipped\b/.test(caseFragment);

    entry.tests += 1;
    entry.time += time;
    totals.tests += 1;
    if (failed) {
        entry.failures += 1;
        totals.failures += 1;
    }
    if (skipped) {
        entry.skipped += 1;
        totals.skipped += 1;
    }

    tests.push({
        name: decode(getAttr(caseFragment, 'name')) || '(unnamed)',
        classname: decode(getAttr(caseFragment, 'classname')) || suiteName,
        time,
        failed,
        skipped,
    });
};

// Read the leading run of @tag tokens from one field, stopping at the first non-tag word. Only
// the leading block is treated as tags — an @handle that appears mid-title (e.g. an it() saying
// "…from @rsksmart/rsk-precompiled-abis") is prose, not a behaviour-area tag, and is ignored.
const leadingTags = (field) => {
    const tags = [];
    for (const token of String(field || '').trim().split(/\s+/)) {
        const match = token.match(TAG_TOKEN_RE);
        if (!match) break;
        tags.push(match[0]);
    }
    return tags;
};

// Extract the distinct @tags a testcase carries. Tags live in the top-level describe title,
// which mocha-junit-reporter folds into the classname; we also read the leading tags of name so
// the grouping still works regardless of the reporter's classname/name arrangement.
const extractTags = (test) => [
    ...new Set([...leadingTags(test.classname), ...leadingTags(test.name)]),
];

// Group durations by behaviour-area tag. A test with N tags counts under each of them; tests
// with no tags fall into a single (untagged) bucket. Coverage grows as P0-02 tagging spreads —
// the table improves with no code change.
const groupByTag = (tests) => {
    const tags = new Map();
    const bump = (key, test) => {
        const entry = tags.get(key) || { key, tests: 0, failures: 0, skipped: 0, time: 0 };
        entry.tests += 1;
        entry.time += test.time;
        if (test.failed) entry.failures += 1;
        if (test.skipped) entry.skipped += 1;
        tags.set(key, entry);
    };
    for (const test of tests) {
        const found = extractTags(test);
        if (found.length === 0) {
            bump(UNTAGGED, test);
        } else {
            for (const tag of found) bump(tag, test);
        }
    }
    return [...tags.values()];
};

// Aggregate one <testsuite> block into the files map and the tests/totals accumulators.
const accumulateSuite = (suiteFragment, files, tests, totals) => {
    const suiteName = decode(getAttr(suiteFragment, 'name')) || '(unnamed)';
    const key = getAttr(suiteFragment, 'file') || suiteName;
    const entry = files.get(key) || { key, tests: 0, failures: 0, skipped: 0, time: 0 };

    for (const caseMatch of suiteFragment.matchAll(CASE_RE)) {
        addTestcase(caseMatch[0], suiteName, entry, tests, totals);
    }

    // A <testsuite> may carry its own time attr; prefer the summed testcase time when we
    // actually counted cases, otherwise fall back to the declared suite time.
    if (entry.tests === 0) {
        const declared = Number.parseFloat(getAttr(suiteFragment, 'time') || '0') || 0;
        entry.time = Math.max(entry.time, declared);
    }
    files.set(key, entry);
};

// Prefer the authoritative totals on the <testsuites> root when available, overriding the
// summed counts. Returns the root-declared total time, or null when absent.
const applyRootTotals = (xml, totals) => {
    const rootMatch = xml.match(/<testsuites\b[^>]*>/);
    if (!rootMatch) {
        return null;
    }
    const rootTests = Number.parseInt(getAttr(rootMatch[0], 'tests') || '', 10);
    const rootFailures = Number.parseInt(getAttr(rootMatch[0], 'failures') || '', 10);
    if (Number.isFinite(rootTests)) {
        totals.tests = rootTests;
    }
    if (Number.isFinite(rootFailures)) {
        totals.failures = rootFailures;
    }
    const rootSkipped = Number.parseInt(getAttr(rootMatch[0], 'skipped') || '', 10);
    if (Number.isFinite(rootSkipped)) {
        totals.skipped = rootSkipped;
    }
    const rootTime = Number.parseFloat(getAttr(rootMatch[0], 'time') || '');
    return Number.isFinite(rootTime) && rootTime > 0 ? rootTime : null;
};

// Parse the mocha-junit-reporter output. Its shape is a flat list of <testsuite> elements
// under a single <testsuites> root, each holding <testcase> children — so attribute-level
// regex parsing is sufficient here (no nesting to track).
function parseJunit(xml) {
    const files = new Map(); // key: file or suite name -> aggregated stats
    const tests = []; // individual testcases, for the "slowest tests" table
    const totals = { tests: 0, failures: 0, skipped: 0 };

    for (const suiteMatch of xml.matchAll(SUITE_RE)) {
        accumulateSuite(suiteMatch[0], files, tests, totals);
    }

    const rootTime = applyRootTotals(xml, totals);
    const fileRows = [...files.values()].filter((f) => f.tests > 0);
    const summedTime = fileRows.reduce((acc, f) => acc + f.time, 0);

    return {
        totalTests: totals.tests,
        totalFailures: totals.failures,
        totalSkipped: totals.skipped,
        totalTime: rootTime != null ? rootTime : summedTime,
        fileRows,
        tagRows: groupByTag(tests),
        tests,
    };
}

function renderPhases(phase) {
    out('## ⏱️ Pipeline phase timing');
    out();
    out('| Phase | Duration |');
    out('| --- | ---: |');
    const rows = [
        ['Setup (bitcoind + federate nodes)', phase.setupSeconds],
        ['&nbsp;&nbsp;↳ mine initial blocks', phase.mineSeconds],
        ['Tests', phase.testsSeconds],
        ['Teardown', phase.teardownSeconds],
    ];
    for (const [label, value] of rows) {
        if (value == null) continue;
        out(`| ${label} | ${fmtDuration(value)} |`);
    }
    if (phase.totalSeconds != null) {
        out(`| **Total (in-container)** | **${fmtDuration(phase.totalSeconds)}** |`);
    }
    out();
}

// Time spent per behaviour area, derived from P0-02 @tags. This is the primary shard-planning
// signal (P2-01/P2-02): it maps durations onto the sharding units in a way the file grouping
// cannot, because every test is require()d from a single entry file.
function renderTimeByTag(tagRows) {
    const sorted = [...tagRows].sort((a, b) => b.time - a.time);
    if (sorted.length === 0) {
        return;
    }
    out('### Time by tag / area');
    out();
    out('| Tag / area | Tests | Failed | Skipped | Time |');
    out('| --- | ---: | ---: | ---: | ---: |');
    for (const t of sorted) {
        out(
            `| \`${escapeCell(t.key)}\` | ${t.tests} | ${t.failures} | ${t.skipped} | ${fmtDuration(t.time)} |`
        );
    }
    out('');
    out('_A test with multiple tags is counted under each; a test counts once toward the totals._');
    out();
}

function renderSlowestFiles(fileRows) {
    const slowest = [...fileRows].sort((a, b) => b.time - a.time);
    // Every test is require()d from a single entry file, so mocha-junit-reporter stamps the same
    // `file` on every testcase and this collapses to one meaningless row. Suppress it in that
    // case — the "Time by tag / area" table is the real per-area breakdown.
    if (slowest.length <= 1) {
        return;
    }
    out(`### Slowest test files (top ${Math.min(TOP_SLOWEST_FILES, slowest.length)})`);
    out();
    out('| Test file / suite | Tests | Failed | Skipped | Time |');
    out('| --- | ---: | ---: | ---: | ---: |');
    for (const f of slowest.slice(0, TOP_SLOWEST_FILES)) {
        out(
            `| \`${escapeCell(f.key)}\` | ${f.tests} | ${f.failures} | ${f.skipped} | ${fmtDuration(f.time)} |`
        );
    }
    out();
}

function renderSlowestTests(tests) {
    const slowest = [...tests].sort((a, b) => b.time - a.time);
    if (slowest.length === 0) {
        return;
    }
    out(`### Slowest individual tests (top ${Math.min(TOP_SLOWEST_TESTS, slowest.length)})`);
    out();
    out('| Test | Time |');
    out('| --- | ---: |');
    for (const t of slowest.slice(0, TOP_SLOWEST_TESTS)) {
        const flag = t.failed ? '❌ ' : '';
        out(`| ${flag}\`${escapeCell(t.name)}\` | ${fmtDuration(t.time)} |`);
    }
    out();
}

function main() {
    if (!safeExists(junitArg)) {
        out('## ⏱️ Test timing summary');
        out();
        out(`> No JUnit report found at \`${junitArg}\` — nothing to summarize.`);
        return;
    }

    // Optional per-phase timing (added by lib/phase-timing.js); render it first when present.
    if (safeExists(phaseArg)) {
        try {
            renderPhases(JSON.parse(safeRead(phaseArg)));
        } catch {
            out(`> Could not parse phase timing at \`${phaseArg}\`.`);
            out();
        }
    }

    let report;
    try {
        report = parseJunit(safeRead(junitArg));
    } catch (err) {
        out('## ⏱️ Test timing summary');
        out();
        out(`> Could not parse \`${junitArg}\`: ${err.message}`);
        return;
    }

    out('## ⏱️ Test timing summary');
    out();
    out(
        `**${report.totalTests}** tests · ` +
            `**${report.totalFailures}** failed · ` +
            `**${report.totalSkipped}** skipped · ` +
            `total test time **${fmtDuration(report.totalTime)}**`
    );
    out();

    renderTimeByTag(report.tagRows);
    renderSlowestFiles(report.fileRows);
    renderSlowestTests(report.tests);

    out(
        `_Source: \`${path.basename(junitArg)}\` (uploaded as the \`rit-junit-report\` artifact)._`
    );
}

main();
