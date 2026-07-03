#!/bin/bash -l

# Warning! As of now, if a modification is made to this entrypoint.sh file, the version/hash of the `Run Rootstock Integration Tests` step at rskj/.github/workflows/rit.yml will need to be updated to match the new commit hash or version of this file.
# This is because the entrypoint.sh file is copied from this hash/version and not from the executing branch, hence, the changes will not be reflected when running the tests from rskj or powpeg-node actions.

set -e
RSKJ_BRANCH="${INPUT_RSKJ_BRANCH}"
POWPEG_NODE_BRANCH="${INPUT_POWPEG_NODE_BRANCH}"
RIT_BRANCH="${INPUT_RIT_BRANCH}"
LOG_LEVEL="${INPUT_RIT_LOG_LEVEL}"
REPO_OWNER="${INPUT_REPO_OWNER:-rsksmart}"  # Default to 'rsksmart' if not provided
RSKJ_REPO="${INPUT_RSKJ_REPO:-rskj}"        # Name of the base rskj repo; default to 'rskj'
GH_TOKEN="${INPUT_GITHUB_TOKEN}"            # Optional; required to clone a private base rskj repo

# URL-encode the branch names before embedding them in the GitHub API path.
# Branch names can legitimately contain slashes (e.g. "feature/foo"); without
# encoding, GitHub treats them as extra path segments and returns 404 even when
# the branch exists. Node is already installed in this container.
RSKJ_BRANCH_ENC=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$RSKJ_BRANCH")
POWPEG_NODE_BRANCH_ENC=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$POWPEG_NODE_BRANCH")

# Inspect the configured base rskj repository. When a token is provided the
# request is authenticated so private repos can be checked; otherwise behaviour
# is identical to the previous public-only flow.
if [[ -n "$GH_TOKEN" ]]; then
  IS_RSKJ_BRANCH=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer ${GH_TOKEN}" "https://api.github.com/repos/$REPO_OWNER/$RSKJ_REPO/branches/$RSKJ_BRANCH_ENC")
else
  IS_RSKJ_BRANCH=$(curl -s -o /dev/null -w "%{http_code}" "https://api.github.com/repos/$REPO_OWNER/$RSKJ_REPO/branches/$RSKJ_BRANCH_ENC")
fi
IS_POWPEG_BRANCH=$(curl -s -o /dev/null -w "%{http_code}" "https://api.github.com/repos/$REPO_OWNER/powpeg-node/branches/$POWPEG_NODE_BRANCH_ENC")

echo -e "\n\n--------- Input parameters received ---------\n\n"
echo "RSKJ_BRANCH=$RSKJ_BRANCH"
echo "POWPEG_NODE_BRANCH=$POWPEG_NODE_BRANCH"
echo "RIT_BRANCH=$RIT_BRANCH"
echo "LOG_LEVEL=$LOG_LEVEL"
echo "REPO_OWNER=$REPO_OWNER"
echo "RSKJ_REPO=$RSKJ_REPO"

echo -e "\n\n--------- Starting the configuration of rskj ---------\n\n"
cd /usr/src/
if [[ "$IS_RSKJ_BRANCH" -eq 200 ]]; then
  echo "Found matching branch name in $REPO_OWNER/$RSKJ_REPO.git repo"
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
  else
    git clone "https://github.com/$REPO_OWNER/$RSKJ_REPO.git" rskj
  fi
elif [[ "$IS_RSKJ_BRANCH" -eq 404 ]]; then
  # Only fall back to upstream rsksmart/rskj when the caller kept the default
  # base repo name. If a custom rskj-repo was explicitly configured, falling
  # back would silently run the tests against a different codebase than
  # requested (and can mask a missing/insufficient token for a private repo),
  # so treat that as a hard error instead.
  if [[ "$RSKJ_REPO" == "rskj" ]]; then
    echo "No branch $RSKJ_BRANCH in $REPO_OWNER/$RSKJ_REPO.git (branch not found, or repo not accessible with the provided token); falling back to default rsksmart/rskj.git repo"
    git clone "https://github.com/rsksmart/rskj.git" rskj
  else
    echo "Error: branch $RSKJ_BRANCH not found in the explicitly configured $REPO_OWNER/$RSKJ_REPO.git (branch missing, or repo not accessible with the provided token). Refusing to fall back to rsksmart/rskj so the tests are not silently run against a different codebase." >&2
    exit 1
  fi
else
  echo "Error: unexpected HTTP status $IS_RSKJ_BRANCH while checking $REPO_OWNER/$RSKJ_REPO for branch $RSKJ_BRANCH (check the token permissions or GitHub rate limits)" >&2
  exit 1
fi
cd rskj && git checkout -f "$RSKJ_BRANCH"
chmod +x ./configure.sh && chmod +x gradlew
./configure.sh

echo -e  "\n\n--------- Starting the configuration of powpeg ---------\n\n"
cd /usr/src/
if [[ "$IS_POWPEG_BRANCH" -eq 200 ]]; then
  echo "Found matching branch name in $REPO_OWNER/powpeg-node.git repo"
  git clone "https://github.com/$REPO_OWNER/powpeg-node.git" powpeg
elif [[ "$IS_POWPEG_BRANCH" -eq 404 ]]; then
  # Only a genuine 404 (branch not found in the configured owner) triggers the
  # fallback to upstream rsksmart/powpeg-node. Any other status (401/403/rate
  # limit) is treated as a hard error so we never silently switch repos.
  echo "No branch $POWPEG_NODE_BRANCH in $REPO_OWNER/powpeg-node.git; falling back to default rsksmart/powpeg-node.git repo"
  git clone "https://github.com/rsksmart/powpeg-node.git" powpeg
else
  echo "Error: unexpected HTTP status $IS_POWPEG_BRANCH while checking $REPO_OWNER/powpeg-node for branch $POWPEG_NODE_BRANCH (check the token permissions or GitHub rate limits)" >&2
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

echo -e "\n\n--------- Executing Rootstock Integration Tests ---------\n\n"
npm install -y
# Capture the exit code without letting `set -e` abort the script, so the
# reporting block below always runs and writes status/message to GITHUB_OUTPUT.
if npm run test-fail-fast; then
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
