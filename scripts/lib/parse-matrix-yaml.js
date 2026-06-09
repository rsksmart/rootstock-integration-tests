const fs = require('fs');
const path = require('path');

function parseIndentedList(lines, startIndex) {
  const items = [];
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    const itemMatch = line.match(/^\s+-\s+"?([^"]+)"?\s*$/);
    if (itemMatch) {
      items.push(itemMatch[1]);
      continue;
    }
    if (line.trim() !== '' && !line.match(/^\s+-/)) {
      break;
    }
  }
  return items;
}

function parseMatrixYaml(yamlPath) {
  const content = fs.readFileSync(yamlPath, 'utf8');
  const lines = content.split('\n');

  let lpsRefs = [];
  let lbcRefs = [];
  const pairs = [];
  let inPairs = false;
  let currentPair = null;

  let inSmokeTests = false;
  let inSmokeCases = false;
  let currentSmokeCase = null;
  const smokeTests = { config: null, cases: [] };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (/^\s+lps:\s*$/.test(line) && !inSmokeTests) {
      lpsRefs = parseIndentedList(lines, i + 1);
      continue;
    }
    if (/^\s+lbc:\s*$/.test(line) && !inSmokeTests) {
      lbcRefs = parseIndentedList(lines, i + 1);
      continue;
    }

    if (line.startsWith('pairs:')) {
      inPairs = true;
      inSmokeTests = false;
      inSmokeCases = false;
      continue;
    }
    if (line.startsWith('preReleasePolicy:') || line.startsWith('crossMajorPolicy:')) {
      inPairs = false;
      inSmokeTests = false;
      inSmokeCases = false;
      if (currentPair) {
        pairs.push(currentPair);
        currentPair = null;
      }
      continue;
    }
    if (line.startsWith('smokeTests:')) {
      inPairs = false;
      inSmokeTests = true;
      inSmokeCases = false;
      if (currentPair) {
        pairs.push(currentPair);
        currentPair = null;
      }
      continue;
    }

    if (inSmokeTests) {
      const configMatch = line.match(/^\s+config:\s+(\S+)\s*$/);
      if (configMatch) {
        smokeTests.config = configMatch[1];
        continue;
      }
      if (/^\s+cases:\s*$/.test(line)) {
        inSmokeCases = true;
        continue;
      }
      if (inSmokeCases) {
        const idMatch = line.match(/^\s+-\s+id:\s+"?([^"]+)"?\s*$/);
        if (idMatch) {
          if (currentSmokeCase) {
            smokeTests.cases.push(currentSmokeCase);
          }
          currentSmokeCase = { id: idMatch[1], file: null, required: true };
          continue;
        }
        const fileMatch = line.match(/^\s+file:\s+(\S+)\s*$/);
        if (fileMatch && currentSmokeCase) {
          currentSmokeCase.file = fileMatch[1];
          continue;
        }
        const requiredMatch = line.match(/^\s+required:\s+(\S+)\s*$/);
        if (requiredMatch && currentSmokeCase) {
          currentSmokeCase.required = requiredMatch[1] === 'true';
        }
      }
      continue;
    }

    if (!inPairs) {
      continue;
    }

    const lpsMatch = line.match(/^\s+-\s+lps:\s+"?([^"]+)"?\s*$/);
    if (lpsMatch) {
      if (currentPair) {
        pairs.push(currentPair);
      }
      currentPair = { lps: lpsMatch[1], lbc: null, status: null };
      continue;
    }
    const lbcMatch = line.match(/^\s+lbc:\s+"?([^"]+)"?\s*$/);
    if (lbcMatch && currentPair) {
      currentPair.lbc = lbcMatch[1];
      continue;
    }
    const statusMatch = line.match(/^\s+status:\s+(\S+)\s*$/);
    if (statusMatch && currentPair) {
      currentPair.status = statusMatch[1];
    }
  }

  if (currentPair) {
    pairs.push(currentPair);
  }
  if (currentSmokeCase) {
    smokeTests.cases.push(currentSmokeCase);
  }

  if (lpsRefs.length === 0) {
    lpsRefs = [...new Set(pairs.map((p) => p.lps))];
  }
  if (lbcRefs.length === 0) {
    lbcRefs = [...new Set(pairs.map((p) => p.lbc))];
  }

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
