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
 * Tolerant of bad input: unreadable/unparsable reports are skipped, and an empty input set still
 * produces a valid (empty) <testsuites> document rather than an error. It does exit non-zero if
 * the output itself cannot be written (unwritable path, or a path refused for escaping the
 * workspace) — that is a real failure, not a degraded report. The workflow step that runs this is
 * `continue-on-error`, so the merge can never turn a passing run red.
 *
 * NOTE: every shard reruns the shared bootstrap (00_sync) on its own chain, so the bootstrap
 * testsuite appears once per shard in the merged report — the cumulative counts are faithful to
 * what actually ran, not de-duplicated.
 */

const fs = require('node:fs');
const path = require('node:path');

const inputDir = process.argv[2] || 'shard-reports';
const outFile = process.argv[3] || 'reports/junit.xml';

// Paths come from argv, so guard them before any file-system access: resolve against the working
// directory (which is GITHUB_WORKSPACE in CI, where the reports live) and confirm the canonical
// path stays inside it. The check is kept inline at each use so a crafted argument that escapes
// the base is refused before it ever reaches the file system. realpathSync can throw (permissions,
// broken symlink); fall back to the plain resolved cwd so module load never crashes the step.
let BASE_DIR;
try {
    BASE_DIR = fs.realpathSync(path.resolve(process.cwd()));
} catch {
    BASE_DIR = path.resolve(process.cwd());
}

const safeReadDir = (dir) => {
    try {
        const resolved = path.resolve(BASE_DIR, dir);
        if (resolved !== BASE_DIR && !resolved.startsWith(BASE_DIR + path.sep)) {
            return [];
        }
        // realpath too, so a symlink under the (artifact-written) reports dir cannot point outside.
        const real = fs.realpathSync(resolved);
        if (real !== BASE_DIR && !real.startsWith(BASE_DIR + path.sep)) {
            return [];
        }
        return fs.readdirSync(real, { withFileTypes: true });
    } catch {
        // Never let a directory probe fail the job — treat as "no reports here".
        return [];
    }
};

const safeReadFile = (file) => {
    try {
        const resolved = path.resolve(BASE_DIR, file);
        if (resolved !== BASE_DIR && !resolved.startsWith(BASE_DIR + path.sep)) {
            return null;
        }
        const real = fs.realpathSync(resolved);
        if (real !== BASE_DIR && !real.startsWith(BASE_DIR + path.sep)) {
            return null;
        }
        return fs.readFileSync(real, 'utf8');
    } catch {
        return null;
    }
};

const safeWriteFile = (file, contents) => {
    const resolved = path.resolve(BASE_DIR, file);
    if (resolved !== BASE_DIR && !resolved.startsWith(BASE_DIR + path.sep)) {
        throw new Error(`Refusing to write outside the workspace: ${file}`);
    }
    // Create the directory first, then re-check its canonical path: a symlinked output dir
    // (e.g. reports -> /tmp) would otherwise pass the prefix check above and escape the workspace.
    const dir = path.dirname(resolved);
    fs.mkdirSync(dir, { recursive: true });
    const realDir = fs.realpathSync(dir);
    if (realDir !== BASE_DIR && !realDir.startsWith(BASE_DIR + path.sep)) {
        throw new Error(`Refusing to follow a symlink outside the workspace: ${file}`);
    }
    fs.writeFileSync(path.join(realDir, path.basename(resolved)), contents, 'utf8');
};

// mocha-junit-reporter emits a flat list of <testsuite> under one <testsuites> root; match each
// <testsuite> block (self-closing or with children) with attribute-level regex — no nesting.
const SUITE_RE = /<testsuite\b[^>]*?(?:\/>|>[\s\S]*?<\/testsuite>)/g;

const getAttr = (fragment, name) => {
    const match = fragment.match(new RegExp(String.raw`\b${name}="([^"]*)"`));
    return match ? match[1] : null;
};

const findReports = (dir) => {
    const out = [];
    for (const entry of safeReadDir(dir)) {
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
        const xml = safeReadFile(file);
        if (xml === null) {
            continue; // skip unreadable/out-of-workspace report
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

    safeWriteFile(outFile, doc);

    process.stderr.write(
        `Merged ${files.length} report file(s) -> ${suites.length} testsuite(s), ` +
            `${totals.tests} tests, ${totals.failures} failures, ${totals.skipped} skipped ` +
            `into ${outFile}\n`
    );
}

try {
    main();
} catch (err) {
    // A refused path (outside the workspace) is a misuse worth failing on, but report it as a
    // clean message rather than an uncaught stack trace.
    process.stderr.write(`ci-merge-junit: ${err.message}\n`);
    process.exit(1);
}
