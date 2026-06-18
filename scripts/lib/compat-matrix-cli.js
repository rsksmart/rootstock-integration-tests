#!/usr/bin/env node
const {
  getMatrixPairs,
  getSmokeTestConfig,
  getSmokeTestIds,
  loadMatrix,
  smokeResultReason,
  smokeStatusFromCounts,
} = require('./compat-matrix-lib');

const cmd = process.argv[2];

function main() {
  const matrix = loadMatrix();

  switch (cmd) {
    case 'lps-refs':
      console.log(matrix.lpsRefs.join('\n'));
      return;
    case 'lbc-refs':
      console.log(matrix.lbcRefs.join('\n'));
      return;
    case 'smoke-tests':
      console.log(getSmokeTestIds(matrix).join(','));
      return;
    case 'smoke-config':
      console.log(getSmokeTestConfig(matrix));
      return;
    case 'pairs-tsv':
      for (const pair of getMatrixPairs(matrix)) {
        console.log(`${pair.lps}\t${pair.lbc}`);
      }
      return;
    case 'pair-count':
      console.log(String(getMatrixPairs(matrix).length));
      return;
    case 'smoke-status': {
      const passed = process.argv[3];
      const total = process.argv[4];
      console.log(smokeStatusFromCounts(passed, total));
      return;
    }
    case 'smoke-reason': {
      const passed = process.argv[3];
      const total = process.argv[4];
      console.log(smokeResultReason(passed, total));
      return;
    }
    default:
      console.error(
        'Usage: compat-matrix-cli.js <lps-refs|lbc-refs|smoke-tests|smoke-config|pairs-tsv|pair-count|smoke-status|smoke-reason>'
      );
      process.exit(1);
  }
}

main();
