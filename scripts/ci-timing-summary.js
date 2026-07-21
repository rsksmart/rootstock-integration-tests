#!/usr/bin/env node
/*
 * CI timing summary — renders the JUnit report (and, when present, the per-phase
 * timing file) as a Markdown table for the GitHub Actions run summary.
 *
 * Usage: node scripts/ci-timing-summary.js [path/to/junit.xml] [path/to/phase-timing.json]
 *
 * Writes Markdown to stdout; the workflow appends it to $GITHUB_STEP_SUMMARY. Designed to
 * never fail the job: missing/unparyable inputs produce a note, not a non-zero exit. The
 * primary consumer of this breakdown is the sharding work (P2-01/P2-02), which needs
 * per-test-file durations to balance shards and to measure wall-clock against the baseline.
 */

const fs = require('node:fs');
const path = require('node:path');

const junitPath = process.argv[2] || 'reports/junit.xml';
const phasePath = process.argv[3] || 'reports/phase-timing.json';

// Number of rows to show in the "slowest" tables; the full data lives in the artifact.
const TOP_SLOWEST_FILES = 30;
const TOP_SLOWEST_TESTS = 15;

const out = (line = '') => process.stdout.write(line + '\n');

const fmtDuration = (seconds) => {
    if (!isFinite(seconds) || seconds < 0) {
        return '—';
    }
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
};

const getAttr = (fragment, name) => {
    const match = fragment.match(new RegExp(`\\b${name}="([^"]*)"`));
    return match ? match[1] : null;
};

const decode = (str) =>
    (str || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');

// Parse the mocha-junit-reporter output. Its shape is a flat list of <testsuite> elements
// under a single <testsuites> root, each holding <testcase> children — so attribute-level
// regex parsing is sufficient here (no nesting to track).
function parseJunit(xml) {
    const suiteRe = /<testsuite\b[^>]*?(?:\/>|>[\s\S]*?<\/testsuite>)/g;
    const caseRe = /<testcase\b[^>]*?(?:\/>|>[\s\S]*?<\/testcase>)/g;

    const files = new Map(); // key: file or suite name -> aggregated stats
    const tests = []; // individual testcases, for the "slowest tests" table
    let totalTests = 0;
    let totalFailures = 0;
    let totalSkipped = 0;

    let suiteMatch;
    while ((suiteMatch = suiteRe.exec(xml)) !== null) {
        const suiteFragment = suiteMatch[0];
        const suiteName = decode(getAttr(suiteFragment, 'name')) || '(unnamed)';
        // mocha emits a "Root Suite" wrapper with no real tests — skip its own row.
        const fileAttr = getAttr(suiteFragment, 'file');
        const key = fileAttr || suiteName;

        const entry = files.get(key) || { key, tests: 0, failures: 0, skipped: 0, time: 0 };

        let caseMatch;
        while ((caseMatch = caseRe.exec(suiteFragment)) !== null) {
            const caseFragment = caseMatch[0];
            const time = parseFloat(getAttr(caseFragment, 'time') || '0') || 0;
            const failed = /<failure\b|<error\b/.test(caseFragment);
            const skipped = /<skipped\b/.test(caseFragment);

            entry.tests += 1;
            entry.time += time;
            totalTests += 1;
            if (failed) {
                entry.failures += 1;
                totalFailures += 1;
            }
            if (skipped) {
                entry.skipped += 1;
                totalSkipped += 1;
            }

            tests.push({
                name: decode(getAttr(caseFragment, 'name')) || '(unnamed)',
                classname: decode(getAttr(caseFragment, 'classname')) || suiteName,
                time,
                failed,
            });
        }

        // A <testsuite> may carry its own time attr; prefer the summed testcase time when we
        // actually counted cases, otherwise fall back to the declared suite time.
        if (entry.tests === 0) {
            const declared = parseFloat(getAttr(suiteFragment, 'time') || '0') || 0;
            entry.time = Math.max(entry.time, declared);
        }
        files.set(key, entry);
    }

    // Prefer the authoritative totals on the <testsuites> root when available.
    const rootMatch = xml.match(/<testsuites\b[^>]*>/);
    let rootTime = null;
    if (rootMatch) {
        rootTime = parseFloat(getAttr(rootMatch[0], 'time') || '');
        const rootTests = parseInt(getAttr(rootMatch[0], 'tests') || '', 10);
        const rootFailures = parseInt(getAttr(rootMatch[0], 'failures') || '', 10);
        if (Number.isFinite(rootTests)) totalTests = rootTests;
        if (Number.isFinite(rootFailures)) totalFailures = rootFailures;
    }

    const fileRows = [...files.values()].filter((f) => f.tests > 0);
    const summedTime = fileRows.reduce((acc, f) => acc + f.time, 0);

    return {
        totalTests,
        totalFailures,
        totalSkipped,
        totalTime: Number.isFinite(rootTime) && rootTime > 0 ? rootTime : summedTime,
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

function main() {
    if (!fs.existsSync(junitPath)) {
        out('## ⏱️ Test timing summary');
        out();
        out(`> No JUnit report found at \`${junitPath}\` — nothing to summarize.`);
        return;
    }

    // Optional per-phase timing (added by lib/phase-timing.js); render it first when present.
    if (fs.existsSync(phasePath)) {
        try {
            renderPhases(JSON.parse(fs.readFileSync(phasePath, 'utf8')));
        } catch {
            out(`> Could not parse phase timing at \`${phasePath}\`.`);
            out();
        }
    }

    let report;
    try {
        report = parseJunit(fs.readFileSync(junitPath, 'utf8'));
    } catch (err) {
        out('## ⏱️ Test timing summary');
        out();
        out(`> Could not parse \`${junitPath}\`: ${err.message}`);
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

    const slowestFiles = [...report.fileRows].sort((a, b) => b.time - a.time);
    if (slowestFiles.length > 0) {
        out(`### Slowest test files (top ${Math.min(TOP_SLOWEST_FILES, slowestFiles.length)})`);
        out();
        out('| Test file / suite | Tests | Failed | Skipped | Time |');
        out('| --- | ---: | ---: | ---: | ---: |');
        for (const f of slowestFiles.slice(0, TOP_SLOWEST_FILES)) {
            out(
                `| \`${f.key}\` | ${f.tests} | ${f.failures} | ${f.skipped} | ${fmtDuration(f.time)} |`
            );
        }
        out();
    }

    const slowestTests = [...report.tests].sort((a, b) => b.time - a.time);
    if (slowestTests.length > 0) {
        out(
            `### Slowest individual tests (top ${Math.min(TOP_SLOWEST_TESTS, slowestTests.length)})`
        );
        out();
        out('| Test | Time |');
        out('| --- | ---: |');
        for (const t of slowestTests.slice(0, TOP_SLOWEST_TESTS)) {
            const flag = t.failed ? '❌ ' : '';
            out(`| ${flag}${t.name} | ${fmtDuration(t.time)} |`);
        }
        out();
    }

    out(
        `_Source: \`${path.basename(junitPath)}\` (uploaded as the \`rit-junit-report\` artifact)._`
    );
}

main();
