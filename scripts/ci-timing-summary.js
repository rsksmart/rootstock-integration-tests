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

// Paths come from argv, so validate them before any file-system access: resolve and confirm
// they stay within the current directory or the CI workspace. This blocks path traversal via
// crafted arguments (a resolved path that escapes every allowed root is refused).
const ALLOWED_ROOTS = [process.cwd()];
if (process.env.GITHUB_WORKSPACE) {
    ALLOWED_ROOTS.push(path.resolve(process.env.GITHUB_WORKSPACE));
}

const resolveWithinAllowed = (p) => {
    const resolved = path.resolve(p);
    const ok = ALLOWED_ROOTS.some(
        (root) => resolved === root || resolved.startsWith(root + path.sep)
    );
    if (!ok) {
        throw new Error(`Refusing to access a path outside the workspace: ${p}`);
    }
    return resolved;
};

const safeExists = (p) => {
    try {
        return fs.existsSync(resolveWithinAllowed(p));
    } catch {
        return false;
    }
};

const safeRead = (p) => fs.readFileSync(resolveWithinAllowed(p), 'utf8');

const out = (line = '') => process.stdout.write(line + '\n');

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
    });
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
        tests,
    };
}

function renderPhases(phase) {
    out('## ⏱️ Pipeline phase timing');
    out();
    out('| Phase | Duration |');
    out('| --- | ---: |');
    const rows = [
        ['Setup (node boot + federates)', phase.setupSeconds],
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

function renderSlowestFiles(fileRows) {
    const slowest = [...fileRows].sort((a, b) => b.time - a.time);
    if (slowest.length === 0) {
        return;
    }
    out(`### Slowest test files (top ${Math.min(TOP_SLOWEST_FILES, slowest.length)})`);
    out();
    out('| Test file / suite | Tests | Failed | Skipped | Time |');
    out('| --- | ---: | ---: | ---: | ---: |');
    for (const f of slowest.slice(0, TOP_SLOWEST_FILES)) {
        out(
            `| \`${f.key}\` | ${f.tests} | ${f.failures} | ${f.skipped} | ${fmtDuration(f.time)} |`
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
        out(`| ${flag}${t.name} | ${fmtDuration(t.time)} |`);
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

    renderSlowestFiles(report.fileRows);
    renderSlowestTests(report.tests);

    out(
        `_Source: \`${path.basename(junitArg)}\` (uploaded as the \`rit-junit-report\` artifact)._`
    );
}

main();
