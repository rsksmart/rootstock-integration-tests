#!/usr/bin/env node
/*
 * Merge the per-shard mocha-junit-reporter XML files into one cumulative JUnit report, so the run
 * has a single <testsuites> document (for the reporting tool, PR annotations, or a download) even
 * though the suite was executed across several sharded jobs.
 *
 * Usage: node scripts/ci-merge-junit.js [input-dir] [output-file]
 *   input-dir   directory searched recursively for *.xml shard reports (default: shard-reports)
 *   output-file cumulative report to write                            (default: reports/junit.xml)
 *
 * Designed to never fail the job: unreadable/unparsable inputs are skipped, and an empty input set
 * still produces a valid (empty) <testsuites> document rather than a non-zero exit.
 *
 * NOTE: every shard reruns the shared bootstrap (00_sync) on its own chain, so the bootstrap
 * testsuite appears once per shard in the merged report — the cumulative counts are faithful to
 * what actually ran, not de-duplicated.
 */

const fs = require('node:fs');
const path = require('node:path');

const inputDir = process.argv[2] || 'shard-reports';
const outFile = process.argv[3] || 'reports/junit.xml';

// mocha-junit-reporter emits a flat list of <testsuite> under one <testsuites> root; match each
// <testsuite> block (self-closing or with children) with attribute-level regex — no nesting.
const SUITE_RE = /<testsuite\b[^>]*?(?:\/>|>[\s\S]*?<\/testsuite>)/g;

const getAttr = (fragment, name) => {
    const match = fragment.match(new RegExp(String.raw`\b${name}="([^"]*)"`));
    return match ? match[1] : null;
};

const findReports = (dir) => {
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out; // missing dir -> no reports
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...findReports(full));
        } else if (entry.isFile() && entry.name.endsWith('.xml')) {
            out.push(full);
        }
    }
    return out;
};

function main() {
    const files = findReports(inputDir).sort();
    const suites = [];
    const totals = { tests: 0, failures: 0, errors: 0, skipped: 0, time: 0 };

    for (const file of files) {
        let xml;
        try {
            xml = fs.readFileSync(file, 'utf8');
        } catch {
            continue; // skip unreadable report
        }
        for (const match of xml.matchAll(SUITE_RE)) {
            const fragment = match[0];
            suites.push(fragment);
            totals.tests += Number.parseInt(getAttr(fragment, 'tests') || '0', 10) || 0;
            totals.failures += Number.parseInt(getAttr(fragment, 'failures') || '0', 10) || 0;
            totals.errors += Number.parseInt(getAttr(fragment, 'errors') || '0', 10) || 0;
            totals.skipped += Number.parseInt(getAttr(fragment, 'skipped') || '0', 10) || 0;
            totals.time += Number.parseFloat(getAttr(fragment, 'time') || '0') || 0;
        }
    }

    const root =
        `<testsuites name="Rootstock Integration Tests (all shards)" ` +
        `tests="${totals.tests}" failures="${totals.failures}" errors="${totals.errors}" ` +
        `skipped="${totals.skipped}" time="${totals.time.toFixed(3)}">`;
    const doc = `<?xml version="1.0" encoding="UTF-8"?>\n${root}\n${suites.join('\n')}\n</testsuites>\n`;

    fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
    fs.writeFileSync(outFile, doc, 'utf8');

    process.stderr.write(
        `Merged ${files.length} report file(s) -> ${suites.length} testsuite(s), ` +
            `${totals.tests} tests, ${totals.failures} failures, ${totals.skipped} skipped ` +
            `into ${outFile}\n`
    );
}

main();
