#!/usr/bin/env node
/*
 * Guard the CI shard matrix against silently dropping tests.
 *
 * The shard membership in .github/workflows/ci.yml is a hardcoded list of INCLUDE_CASES prefixes.
 * A newly added test file that nobody adds to a shard would simply never run in RIT's own sharded
 * pipeline — passing CI while testing nothing. This check fails the build instead.
 *
 * Usage: node scripts/ci-check-shard-coverage.js '<matrix json>'
 *   matrix json: the {"include":[{"name":...,"cases":"a,b,c"}, ...]} object the workflow computes.
 *
 * A shard whose `cases` is empty runs the whole suite, so the check is a no-op in that case
 * (this is how the short suite runs).
 *
 * Exits non-zero when an expected-to-run test file is not covered by any shard.
 */

const fs = require('node:fs');
const path = require('node:path');

const writeOut = (msg) => process.stdout.write(`${msg}\n`);
const writeErr = (msg) => process.stderr.write(`${msg}\n`);

const TESTS_DIR = 'tests';

// Files that are intentionally not in any shard because they do not run in the serial suite
// either. `describe.skip`-ed files are detected automatically and need no entry here.
const KNOWN_EXCLUSIONS = new Map([
    [
        '99_fork_activation/extra/01-activate-latest-fork.js',
        'inert: the execute() call is commented out (fork activation is opt-in)',
    ],
]);

const listTestFiles = (dir, base = dir) => {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listTestFiles(full, base));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(path.relative(base, full));
        }
    }
    return out;
};

// Mirror test.js#needsToBeTested: a pattern matches either the path relative to tests/ or the
// bare filename.
const matchesPattern = (relativePath, pattern) =>
    relativePath.startsWith(pattern) || path.basename(relativePath).startsWith(pattern);

// Parse and validate the matrix argument, exiting with a usage error when it is unusable.
const parseMatrix = (raw) => {
    if (!raw) {
        writeErr('Usage: ci-check-shard-coverage.js <matrix json>');
        process.exit(2);
    }
    let matrix;
    try {
        matrix = JSON.parse(raw);
    } catch (err) {
        writeErr(`Could not parse the matrix JSON: ${err.message}`);
        process.exit(2);
    }
    const shards = matrix.include || [];
    if (shards.length === 0) {
        writeErr('The matrix has no shards.');
        process.exit(2);
    }
    return shards;
};

// A file may be absent from every shard only if it does not run in the serial suite either.
const isExpectedToRun = (file) => {
    if (KNOWN_EXCLUSIONS.has(file)) {
        return false;
    }
    const source = fs.readFileSync(path.join(TESTS_DIR, file), 'utf8');
    return !source.includes('describe.skip(');
};

function main() {
    const shards = parseMatrix(process.argv[2]);

    // An empty `cases` means "run everything" — nothing can be dropped.
    if (shards.some((s) => !s.cases)) {
        writeOut('A shard runs the whole suite (empty cases); coverage check not applicable.');
        return;
    }

    const patterns = shards.flatMap((s) => s.cases.split(',').filter(Boolean));
    const files = listTestFiles(TESTS_DIR).sort();

    const uncovered = files.filter(
        (file) => !patterns.some((p) => matchesPattern(file, p)) && isExpectedToRun(file)
    );
    // A pattern that matches nothing is usually a typo or a renamed/deleted file.
    const deadPatterns = patterns.filter((p) => !files.some((f) => matchesPattern(f, p)));

    if (uncovered.length > 0 || deadPatterns.length > 0) {
        for (const file of uncovered) {
            writeErr(
                `::error::Test file not assigned to any CI shard: tests/${file} — add it to a shard in .github/workflows/ci.yml`
            );
        }
        for (const pattern of deadPatterns) {
            writeErr(
                `::error::Shard pattern matches no test file: "${pattern}" — stale entry in .github/workflows/ci.yml`
            );
        }
        process.exit(1);
    }

    writeOut(
        `Shard coverage OK: ${files.length} test file(s), all runnable ones assigned to a shard.`
    );
}

main();
