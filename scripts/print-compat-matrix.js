#!/usr/bin/env node
const fs = require('fs');
const { cellKey, loadMatrix, smokeStatusFromCounts } = require('./lib/compat-matrix-lib');

const GREEN = '\x1b[32m';
const ORANGE = '\x1b[33m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function declaredStatusDisplay(status) {
  switch (status) {
    case 'supported':
      return { label: 'SUPPORTED', color: GREEN };
    case 'not-tested':
      return { label: 'NOT TESTED', color: ORANGE };
    case 'unsupported':
      return { label: 'UNSUPPORTED', color: RED };
    default:
      return { label: 'UNKNOWN', color: GRAY };
  }
}

function normalizeCellResult(value) {
  if (!value) {
    return { status: 'pending', passed: 0, failed: 0, total: 0 };
  }
  if (typeof value === 'string') {
    return { status: value, passed: 0, failed: 0, total: 0 };
  }
  const passed = value.passed ?? 0;
  const total = value.total ?? 0;
  const status =
    value.status ??
    (total > 0 ? smokeStatusFromCounts(passed, total) : 'pending');
  return {
    status,
    passed,
    failed: value.failed ?? 0,
    total,
    reason: value.reason,
  };
}

function runStatusDisplay(result) {
  const { status, passed, total } = normalizeCellResult(result);
  if (status === 'pass') {
    return { label: `${passed}/${total}`, color: GREEN };
  }
  if (status === 'partial') {
    return { label: `${passed}/${total}`, color: ORANGE };
  }
  if (status === 'fail') {
    const label = total > 0 ? `${passed}/${total}` : 'FAIL';
    return { label, color: RED };
  }
  if (status === 'skip') {
    return { label: 'SKIP', color: GRAY };
  }
  return { label: 'PENDING', color: GRAY };
}

function padVisible(text, width) {
  const visibleLen = text.replace(/\x1b\[[0-9;]*m/g, '').length;
  if (visibleLen >= width) {
    return text;
  }
  return text + ' '.repeat(width - visibleLen);
}

function printGrid({ title, subtitle, lpsRefs, lbcRefs, cellRenderer, legend }) {
  const cellWidth = 14;
  const lpsColWidth = 10;

  console.log('');
  console.log(`${BOLD}${title}${RESET}`);
  if (subtitle) {
    console.log(`${DIM}${subtitle}${RESET}`);
  }
  console.log('');

  let header = padVisible(`${BOLD}LPS \\ LBC${RESET}`, lpsColWidth);
  for (const lbc of lbcRefs) {
    header += padVisible(`${BOLD}${lbc}${RESET}`, cellWidth);
  }
  console.log(header);

  let separator = '-'.repeat(lpsColWidth);
  for (let i = 0; i < lbcRefs.length; i += 1) {
    separator += '-'.repeat(cellWidth);
  }
  console.log(separator);

  for (const lps of lpsRefs) {
    let row = padVisible(lps, lpsColWidth);
    for (const lbc of lbcRefs) {
      const { label, color } = cellRenderer(lps, lbc);
      row += padVisible(`${color}${BOLD}${label}${RESET}`, cellWidth);
    }
    console.log(row);
  }

  console.log('');
  console.log(`${BOLD}Legend${RESET}`);
  for (const line of legend) {
    console.log(line);
  }
  console.log('');
}

function printDeclaredMatrix(matrix) {
  const statusByKey = new Map(matrix.pairs.map((p) => [cellKey(p.lps, p.lbc), p.status]));

  printGrid({
    title: 'LPS × LBC compatibility matrix (declared)',
    subtitle: `Source: ${matrix.yamlPath}`,
    lpsRefs: matrix.lpsRefs,
    lbcRefs: matrix.lbcRefs,
    cellRenderer: (lps, lbc) =>
      declaredStatusDisplay(statusByKey.get(cellKey(lps, lbc)) ?? 'unknown'),
    legend: [
      `  ${GREEN}${BOLD}SUPPORTED${RESET}    Declared safe for split-contract deployments`,
      `  ${ORANGE}${BOLD}NOT TESTED${RESET}  In matrix scope; not yet validated`,
      `  ${RED}${BOLD}UNSUPPORTED${RESET}  Declared incompatible`,
    ],
  });
}

function printRunResultsMatrix(matrix, runResults) {
  printGrid({
    title: 'LPS × LBC compatibility matrix (smoke results)',
    subtitle: runResults.completedAt
      ? `Completed: ${runResults.completedAt}`
      : 'Live run results',
    lpsRefs: matrix.lpsRefs,
    lbcRefs: matrix.lbcRefs,
    cellRenderer: (lps, lbc) =>
      runStatusDisplay(runResults.cells?.[cellKey(lps, lbc)]),
    legend: [
      `  ${GREEN}${BOLD}N/N${RESET}  All smoke tests passed`,
      `  ${ORANGE}${BOLD}N/N${RESET}  Some smoke tests passed`,
      `  ${RED}${BOLD}0/N${RESET}  No smoke tests passed (or deploy failed)`,
    ],
  });

  const cells = Object.entries(runResults.cells || {}).map(([key, value]) => [
    key,
    normalizeCellResult(value),
  ]);
  const green = cells.filter(([, value]) => value.status === 'pass');
  const orange = cells.filter(([, value]) => value.status === 'partial');
  const red = cells.filter(([, value]) => value.status === 'fail');
  const total = matrix.lpsRefs.length * matrix.lbcRefs.length;
  console.log(
    `${BOLD}Summary:${RESET} ${green.length} green, ${orange.length} orange, ${red.length} red, ${total - green.length - orange.length - red.length} pending`
  );

  const needsAttention = cells.filter(([, value]) => value.status === 'partial' || value.status === 'fail');
  if (needsAttention.length > 0) {
    console.log('');
    console.log(`${BOLD}Details:${RESET}`);
    for (const [key, { status, passed, total: cellTotal, reason }] of needsAttention) {
      const [lps, lbc] = key.split('|');
      const icon = status === 'partial' ? `${ORANGE}!` : `${RED}✗`;
      const score = cellTotal > 0 ? `${passed}/${cellTotal} smokes` : 'no smokes run';
      const detail = reason ? ` — ${reason}` : '';
      console.log(`  ${icon}${RESET} LPS ${lps} × LBC ${lbc}: ${score}${detail}`);
    }
  }
  console.log('');
}

function loadRunResults(path) {
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function main() {
  const matrix = loadMatrix();
  const args = process.argv.slice(2);

  if (args[0] === '--declared') {
    printDeclaredMatrix(matrix);
    return;
  }

  if (args[0] === '--run-results' && args[1]) {
    printRunResultsMatrix(matrix, loadRunResults(args[1]));
    return;
  }

  printDeclaredMatrix(matrix);
}

main();
