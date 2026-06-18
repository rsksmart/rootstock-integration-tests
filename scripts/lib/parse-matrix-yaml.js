const fs = require('node:fs');
const path = require('node:path');
const yaml = require('yaml');

function normalizeSmokeCase(smokeCase) {
  return {
    id: smokeCase.id,
    file: smokeCase.file ?? null,
    required: smokeCase.required !== false,
  };
}

function normalizePair(pair) {
  return {
    lps: pair.lps,
    lbc: pair.lbc,
    status: pair.status ?? null,
  };
}

function resolveAxisRefs(explicitRefs, pairs, axis) {
  if (explicitRefs.length > 0) {
    return explicitRefs;
  }
  return [...new Set(pairs.map((pair) => pair[axis]))];
}

function parseMatrixYaml(yamlPath) {
  const content = fs.readFileSync(yamlPath, 'utf8');
  const doc = yaml.parse(content) ?? {};

  const pairs = (doc.pairs ?? []).map(normalizePair);
  const smokeTests = {
    config: doc.smokeTests?.config ?? null,
    cases: (doc.smokeTests?.cases ?? []).map(normalizeSmokeCase),
  };

  const lpsRefs = resolveAxisRefs(doc.supportWindow?.lps ?? [], pairs, 'lps');
  const lbcRefs = resolveAxisRefs(doc.supportWindow?.lbc ?? [], pairs, 'lbc');

  return {
    lpsRefs,
    lbcRefs,
    pairs,
    smokeTests,
    yamlPath,
  };
}

function cellKey(lps, lbc) {
  return `${lps}|${lbc}`;
}

function defaultMatrixPath() {
  return path.join(__dirname, '..', '..', 'compat', 'lps-lbc-matrix.yaml');
}

module.exports = {
  parseMatrixYaml,
  cellKey,
  defaultMatrixPath,
};
