const { parseMatrixYaml, defaultMatrixPath, cellKey } = require('./parse-matrix-yaml');

function smokeStatusFromCounts(passed, total) {
  const p = Number(passed);
  const t = Number(total);
  if (p === t && t > 0) {
    return 'pass';
  }
  if (p > 0) {
    return 'partial';
  }
  return 'fail';
}

function smokeResultReason(passed, total) {
  const p = Number(passed);
  const t = Number(total);
  if (p > 0 && p < t) {
    return `${p}/${t} smokes passed`;
  }
  if (p === 0 && t > 0) {
    return `0/${t} smokes passed`;
  }
  return '';
}

function getSmokeTestIds(matrix) {
  return (matrix.smokeTests?.cases ?? []).map((c) => c.id).filter(Boolean);
}

function getSmokeTestConfig(matrix) {
  return matrix.smokeTests?.config ?? 'config/regtest-external-lps-smoke.js';
}

function getMatrixPairs(matrix) {
  if (matrix.pairs?.length) {
    return matrix.pairs.map((p) => ({ lps: p.lps, lbc: p.lbc }));
  }
  const pairs = [];
  for (const lps of matrix.lpsRefs) {
    for (const lbc of matrix.lbcRefs) {
      pairs.push({ lps, lbc });
    }
  }
  return pairs;
}

function loadMatrix(yamlPath = process.env.COMPAT_MATRIX_YAML || defaultMatrixPath()) {
  return parseMatrixYaml(yamlPath);
}

module.exports = {
  cellKey,
  defaultMatrixPath,
  getMatrixPairs,
  getSmokeTestConfig,
  getSmokeTestIds,
  loadMatrix,
  smokeResultReason,
  smokeStatusFromCounts,
};
