#!/usr/bin/env bash
#
# Run smoke tests for each pair in compat/lps-lbc-matrix.yaml.
# Green = all smokes pass, orange = some pass, red = none pass.
#
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_SCRIPT="${SCRIPT_DIR}/run-lps-lbc-compat-check.sh"
MATRIX_CLI="${SCRIPT_DIR}/lib/compat-matrix-cli.js"

matrix_cli() {
  node "$MATRIX_CLI" "$@"
  return 0
}

TOTAL_CELLS="$(matrix_cli pair-count)"
RESULTS_FILE="$(mktemp "${TMPDIR:-/tmp}/compat-matrix-results-XXXXXX.json")"
GREEN_CELLS=0
ORANGE_CELLS=0
RED_CELLS=0
CELL_INDEX=0

cleanup() {
  rm -f "$RESULTS_FILE"
  return 0
}
trap cleanup EXIT

init_results_file() {
  node -e "
const fs = require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({ startedAt: new Date().toISOString(), cells: {} }, null, 2));
" "$RESULTS_FILE"
  return 0
}

record_cell_result() {
  local lps_ref="$1"
  local lbc_ref="$2"
  local status="$3"
  local passed="$4"
  local failed="$5"
  local total="$6"
  local reason="${7:-}"
  LPS_REF="$lps_ref" LBC_REF="$lbc_ref" STATUS="$status" PASSED="$passed" FAILED="$failed" \
    TOTAL="$total" REASON="$reason" RESULTS_FILE="$RESULTS_FILE" node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.env.RESULTS_FILE, 'utf8'));
const key = process.env.LPS_REF + '|' + process.env.LBC_REF;
const cell = {
  status: process.env.STATUS,
  passed: Number(process.env.PASSED),
  failed: Number(process.env.FAILED),
  total: Number(process.env.TOTAL),
};
if (process.env.REASON) {
  cell.reason = process.env.REASON;
}
data.cells[key] = cell;
fs.writeFileSync(process.env.RESULTS_FILE, JSON.stringify(data, null, 2));
"
  return 0
}

finalize_results_file() {
  node -e "
const fs = require('fs');
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
data.completedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(data, null, 2));
" "$RESULTS_FILE"
  return 0
}

parse_smoke_summary() {
  local log="$1"
  local line
  line="$(grep 'COMPAT_SMOKE_SUMMARY' "$log" | tail -1 || true)"
  if [[ -z "$line" ]]; then
    return 1
  fi
  SMOKE_PASSED="$(echo "$line" | sed -n 's/.*passed=\([0-9]*\).*/\1/p')"
  SMOKE_FAILED="$(echo "$line" | sed -n 's/.*failed=\([0-9]*\).*/\1/p')"
  SMOKE_TOTAL="$(echo "$line" | sed -n 's/.*total=\([0-9]*\).*/\1/p')"
  return 0
}

extract_failure_reason() {
  local log="$1"
  local reason=""

  if parse_smoke_summary "$log"; then
    reason="$(matrix_cli smoke-reason "$SMOKE_PASSED" "$SMOKE_TOTAL")"
    if [[ -n "$reason" ]]; then
      echo "$reason"
      return 0
    fi
  fi

  reason="$(grep -E 'ERROR:' "$log" | tail -1 | sed 's/^ERROR: //' || true)"
  if [[ -z "$reason" ]] && grep -q 'chown:.*Operation not permitted' "$log"; then
    reason="Docker volume ownership conflict (chown failed)"
  fi
  if [[ -z "$reason" ]] && grep -q 'LPS failed to start' "$log"; then
    reason="LPS failed health check during deploy (see docker logs lps01)"
  fi
  if [[ -z "$reason" ]]; then
    reason="$(grep -Ei 'AssertionError|failing|Error:' "$log" | tail -1 || true)"
  fi
  if [[ -z "$reason" ]]; then
    reason="smoke run failed before summary (see logs above)"
  fi

  reason="${reason//$'\n'/ }"
  reason="${reason:0:240}"
  echo "$reason"
  return 0
}

run_cell() {
  local lps_ref="$1"
  local lbc_ref="$2"
  local cell_log exit_code status passed failed total reason
  CELL_INDEX=$((CELL_INDEX + 1))
  cell_log="$(mktemp "${TMPDIR:-/tmp}/compat-cell-log-XXXXXX")"

  echo ""
  echo "========================================"
  echo "Matrix cell ${CELL_INDEX}/${TOTAL_CELLS}: LPS ${lps_ref} x LBC ${lbc_ref}"
  echo "========================================"

  set +e
  "$CHECK_SCRIPT" --clean-before-up --lps-ref "$lps_ref" --lbc-ref "$lbc_ref" 2>&1 | tee "$cell_log"
  exit_code="${PIPESTATUS[0]}"
  set -e

  if parse_smoke_summary "$cell_log"; then
    passed="$SMOKE_PASSED"
    failed="$SMOKE_FAILED"
    total="$SMOKE_TOTAL"
    status="$(matrix_cli smoke-status "$passed" "$total")"
  else
    passed=0
    failed=0
    total=0
    status="fail"
  fi

  reason="$(extract_failure_reason "$cell_log")"
  record_cell_result "$lps_ref" "$lbc_ref" "$status" "$passed" "$failed" "$total" "$reason"

  case "$status" in
    pass)
      GREEN_CELLS=$((GREEN_CELLS + 1))
      echo "Cell result: ${passed}/${total} smokes — ALL PASS"
      ;;
    partial)
      ORANGE_CELLS=$((ORANGE_CELLS + 1))
      echo "Cell result: ${passed}/${total} smokes — PARTIAL (continuing)"
      ;;
    *)
      RED_CELLS=$((RED_CELLS + 1))
      echo "Cell result: ${passed}/${total} smokes — FAIL (${reason})"
      ;;
  esac

  rm -f "$cell_log"
  if [[ "$status" == "pass" ]]; then
    return 0
  fi
  return 1
}

echo "=== LPS x LBC smoke matrix (${TOTAL_CELLS} pairs from compat/lps-lbc-matrix.yaml) ==="
echo ""

init_results_file

while IFS=$'\t' read -r lps_ref lbc_ref; do
  [[ -z "$lps_ref" ]] && continue
  run_cell "$lps_ref" "$lbc_ref" || true
done < <(matrix_cli pairs-tsv)

finalize_results_file

node "${SCRIPT_DIR}/print-compat-matrix.js" --run-results "$RESULTS_FILE"

echo "=== Matrix run complete ==="
echo "Green: ${GREEN_CELLS}/${TOTAL_CELLS}  Orange: ${ORANGE_CELLS}/${TOTAL_CELLS}  Red: ${RED_CELLS}/${TOTAL_CELLS}"

if [[ $RED_CELLS -gt 0 || $ORANGE_CELLS -gt 0 ]]; then
  exit 1
fi
