#!/bin/bash -l

# Note: this file is consumed directly by rskj and powpeg-node CI, which reference
# this action via `@main` (not a pinned commit/tag). Changes here take effect in
# their pipelines on the very next run — there is no version pin to bump and no
# review gate on their side, so test changes carefully before merging to main.

set -e
RSKJ_BRANCH="${INPUT_RSKJ_BRANCH}"
POWPEG_NODE_BRANCH="${INPUT_POWPEG_NODE_BRANCH}"
RIT_BRANCH="${INPUT_RIT_BRANCH}"
LOG_LEVEL="${INPUT_RIT_LOG_LEVEL}"
REPO_OWNER="${INPUT_REPO_OWNER:-rsksmart}"  # Default to 'rsksmart' if not provided
RSKJ_REPO="${INPUT_RSKJ_REPO:-rskj}"        # Name of the base rskj repo; default to 'rskj'
GH_TOKEN="${INPUT_GITHUB_TOKEN}"            # Optional; required to clone a private base rskj repo
TEST_SUITE="${INPUT_TEST_SUITE:-full}"      # Default to 'full' (long) suite if not provided

# Resolve whether a git ref exists in a GitHub repository. The inputs may be a
# branch, a tag or a specific commit (see container-action/README.md), so we use
# the ref-aware REST "commits/{ref}" endpoint, which resolves all three, instead
# of "branches/{ref}", which only matches branch names (and would 404 for a
# valid tag/commit). The ref is URL-encoded because it can contain slashes
# (e.g. "feature/foo"); Node is already installed in this container.
#
# Echoes "found", "notfound" or "error:<http_code>" so callers can keep 404 as
# the only fallback case and fail fast on any other status (auth, invalid ref,
# rate limits, ...). When a token is set the request is authenticated so private
# repos can be inspected.
ref_status() {
  local owner="$1" repo="$2" ref="$3" ref_enc code
  ref_enc=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$ref")
  if [[ -n "$GH_TOKEN" ]]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${GH_TOKEN}" "https://api.github.com/repos/$owner/$repo/commits/$ref_enc")
  else
    code=$(curl -s -o /dev/null -w "%{http_code}" "https://api.github.com/repos/$owner/$repo/commits/$ref_enc")
  fi
  if [[ "$code" -eq 200 ]]; then
    echo "found"
  elif [[ "$code" -eq 404 ]]; then
    # 404 is the only "ref not found" case (or repo not accessible with the
    # given token) and the sole trigger for the upstream fallback.
    echo "notfound"
  else
    # Everything else (401/403 auth, 422 unprocessable/invalid ref, rate limits,
    # 5xx, ...) is a hard error so we fail fast instead of silently switching
    # repos.
    echo "error:$code"
  fi
}

RSKJ_REF_STATUS=$(ref_status "$REPO_OWNER" "$RSKJ_REPO" "$RSKJ_BRANCH")
POWPEG_REF_STATUS=$(ref_status "$REPO_OWNER" "powpeg-node" "$POWPEG_NODE_BRANCH")

echo -e "\n\n--------- Input parameters received ---------\n\n"
echo "RSKJ_BRANCH=$RSKJ_BRANCH"
echo "POWPEG_NODE_BRANCH=$POWPEG_NODE_BRANCH"
echo "RIT_BRANCH=$RIT_BRANCH"
echo "LOG_LEVEL=$LOG_LEVEL"
echo "REPO_OWNER=$REPO_OWNER"
echo "RSKJ_REPO=$RSKJ_REPO"
echo "TEST_SUITE=$TEST_SUITE"

echo -e "\n\n--------- Starting the configuration of rskj ---------\n\n"
cd /usr/src/
if [[ "$RSKJ_REF_STATUS" == "found" ]]; then
  echo "Found matching ref $RSKJ_BRANCH in $REPO_OWNER/$RSKJ_REPO.git repo"
  # Pass the token via a per-command HTTP header (with -c) so it is never
  # embedded in the remote URL nor persisted in rskj/.git/config. GitHub's
  # git-over-HTTPS endpoint expects Basic auth (base64 of "x-access-token:<token>"),
  # not a bearer scheme, so build the credential accordingly.
  if [[ -n "$GH_TOKEN" ]]; then
    GH_BASIC_AUTH=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 | tr -d '\n')
    # Mask the derived credential so it is not printed in logs (e.g. under
    # GIT_TRACE_CURL=1); it differs from the original secret so Actions would
    # not mask it automatically.
    echo "::add-mask::${GH_BASIC_AUTH}"
    GIT_TERMINAL_PROMPT=0 git -c http.extraheader="Authorization: Basic ${GH_BASIC_AUTH}" clone "https://github.com/$REPO_OWNER/$RSKJ_REPO.git" rskj
    unset GH_BASIC_AUTH
  else
    git clone "https://github.com/$REPO_OWNER/$RSKJ_REPO.git" rskj
  fi
elif [[ "$RSKJ_REF_STATUS" == "notfound" ]]; then
  # Only fall back to upstream rsksmart/rskj when the caller kept the default
  # base repo name. If a custom rskj-repo was explicitly configured, falling
  # back would silently run the tests against a different codebase than
  # requested (and can mask a missing/insufficient token for a private repo),
  # so treat that as a hard error instead.
  if [[ "$RSKJ_REPO" == "rskj" ]]; then
    echo "No ref $RSKJ_BRANCH in $REPO_OWNER/$RSKJ_REPO.git (branch/tag/commit not found, or repo not accessible with the provided token); falling back to default rsksmart/rskj.git repo"
    git clone "https://github.com/rsksmart/rskj.git" rskj
  else
    echo "Error: ref $RSKJ_BRANCH not found in the explicitly configured $REPO_OWNER/$RSKJ_REPO.git (branch/tag/commit missing, or repo not accessible with the provided token). Refusing to fall back to rsksmart/rskj so the tests are not silently run against a different codebase." >&2
    exit 1
  fi
else
  echo "Error: unexpected HTTP status ${RSKJ_REF_STATUS#error:} while checking $REPO_OWNER/$RSKJ_REPO for ref $RSKJ_BRANCH (invalid ref, insufficient token permissions, or GitHub rate limits)" >&2
  exit 1
fi
cd rskj && git checkout -f "$RSKJ_BRANCH"
chmod +x ./configure.sh && chmod +x gradlew
./configure.sh

echo -e  "\n\n--------- Starting the configuration of powpeg ---------\n\n"
cd /usr/src/
if [[ "$POWPEG_REF_STATUS" == "found" ]]; then
  echo "Found matching ref $POWPEG_NODE_BRANCH in $REPO_OWNER/powpeg-node.git repo"
  git clone "https://github.com/$REPO_OWNER/powpeg-node.git" powpeg
elif [[ "$POWPEG_REF_STATUS" == "notfound" ]]; then
  # Only a genuine not-found (branch/tag/commit absent in the configured owner)
  # triggers the fallback to upstream rsksmart/powpeg-node. Any other status
  # (401/403/rate limit) is treated as a hard error so we never silently switch
  # repos.
  echo "No ref $POWPEG_NODE_BRANCH in $REPO_OWNER/powpeg-node.git; falling back to default rsksmart/powpeg-node.git repo"
  git clone "https://github.com/rsksmart/powpeg-node.git" powpeg
else
  echo "Error: unexpected HTTP status ${POWPEG_REF_STATUS#error:} while checking $REPO_OWNER/powpeg-node for ref $POWPEG_NODE_BRANCH (invalid ref, insufficient token permissions, or GitHub rate limits)" >&2
  exit 1
fi
cp configure_gradle_powpeg.sh powpeg
cd powpeg && git checkout -f "$POWPEG_NODE_BRANCH"
chmod +x ./configure.sh && chmod +x gradlew
POWPEG_VERSION=$(bash configure_gradle_powpeg.sh)
echo "POWPEG_VERSION=$POWPEG_VERSION"
./configure.sh
./gradlew  --info --no-daemon --dependency-verification=lenient clean build -x test

echo -e "\n\n--------- Starting the configuration of RIT ---------\n\n"

cd /usr/src/
git clone https://github.com/rsksmart/rootstock-integration-tests.git rit
cd rit

echo -e "\n\n--------- Checking out the RIT branch: $RIT_BRANCH ---------\n\n"
git checkout -f "$RIT_BRANCH"

mv container-action/scripts/configure_rit_locally.sh .

echo -e "\n\n--------- Copying configuration files ---------\n\n"
chmod +x ./configure.sh
chmod +x ./configure_rit_locally.sh

./configure.sh
./configure_rit_locally.sh "${POWPEG_VERSION}"

export LOG_LEVEL="$LOG_LEVEL"

# --- P0-01: preserve the JUnit report for CI artifact upload (on pass or fail) ---
# The suite writes reports/junit.xml inside this container. GITHUB_WORKSPACE is the
# runner-host path mounted in by the container action (and by the docker-run CI job).
# Copying the report there on EXIT lets actions/upload-artifact collect it on every
# exit path, including the `exit 1` taken when the test run fails below.
copy_junit_report() {
  local report="/usr/src/rit/reports/junit.xml"
  local dest="${GITHUB_WORKSPACE:-}/reports"
  # Nothing to do when not running under Actions or the suite produced no report.
  [ -n "${GITHUB_WORKSPACE:-}" ] && [ -f "$report" ] || return 0
  # Guard the copy in a conditional so a failure neither aborts the trap under
  # `set -e` nor gets reported as a success.
  if mkdir -p "$dest" && cp "$report" "$dest/junit.xml"; then
    echo "Copied JUnit report to $dest/junit.xml"
  else
    echo "Warning: could not copy JUnit report to $dest/junit.xml" >&2
  fi
}
trap copy_junit_report EXIT

echo -e "\n\n--------- Executing Rootstock Integration Tests ($TEST_SUITE suite) ---------\n\n"
npm install -y
if [[ "$TEST_SUITE" == "short" ]]; then
  TEST_SCRIPT=test-short-fail-fast
else
  TEST_SCRIPT=test-fail-fast
fi
# Capture the exit code without letting `set -e` abort the script, so the
# reporting block below always runs and writes status/message to GITHUB_OUTPUT.
if npm run "$TEST_SCRIPT"; then
  STATUS=0
else
  STATUS=$?
fi

echo -e "\n\n--------- RIT Tests Result ---------\n\n"
if [[ "$STATUS" -ne 0 ]]; then
  MESSAGE="Rootstock Integration Tests Status: FAILED"
else
  MESSAGE="Rootstock Integration Tests Status: PASSED"
fi
echo -e "$MESSAGE"

echo "status=${STATUS}" >> "${GITHUB_OUTPUT}"
echo "message=${MESSAGE}" >> "${GITHUB_OUTPUT}"

if [[ "$STATUS" -ne 0 ]]; then
  exit 1
fi
exit 0
