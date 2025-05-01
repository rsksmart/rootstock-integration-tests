#!/bin/sh -l

# Warning! As of now, if a modification is made to this entrypoint.sh file, the version/hash of the `Run Rootstock Integration Tests` step at rskj/.github/workflows/rit.yml will need to be updated to match the new commit hash or version of this file.
# This is because the entrypoint.sh file is copied from this hash/version and not from the executing branch, hence, the changes will not be reflected when running the tests from rskj or powpeg-node actions.

set -e
RSKJ_BRANCH="${INPUT_RSKJ_BRANCH}"
POWPEG_NODE_BRANCH="${INPUT_POWPEG_NODE_BRANCH}"
RIT_BRANCH="${INPUT_RIT_BRANCH}"
LOG_LEVEL="${INPUT_RIT_LOG_LEVEL}"
REPO_OWNER="${INPUT_REPO_OWNER:-rsksmart}"  # Default to 'rsksmart' if not provided
IS_RSKJ_BRANCH=$(curl -s -o /dev/null -w "%{http_code}" "https://api.github.com/repos/$REPO_OWNER/rskj/branches/$RSKJ_BRANCH")
IS_POWPEG_BRANCH=$(curl -s -o /dev/null -w "%{http_code}" "https://api.github.com/repos/$REPO_OWNER/powpeg-node/branches/$POWPEG_NODE_BRANCH")

echo -e "\n\n--------- Input parameters received ---------\n\n"
echo "RSKJ_BRANCH=$RSKJ_BRANCH"
echo "POWPEG_NODE_BRANCH=$POWPEG_NODE_BRANCH"
echo "RIT_BRANCH=$RIT_BRANCH"
echo "LOG_LEVEL=$LOG_LEVEL"
echo "REPO_OWNER=$REPO_OWNER"

echo -e "\n\n--------- Starting the configuration of rskj ---------\n\n"
cd /usr/src/
if [ "$IS_RSKJ_BRANCH" -eq 200 ]; then
  echo "Found matching branch name in $REPO_OWNER/rskj.git repo"
  git clone "https://github.com/$REPO_OWNER/rskj.git" rskj
else
  echo "Found matching branch name in rsksmart/rskj.git repo"
  git clone "https://github.com/rsksmart/rskj.git" rskj
fi
cd rskj && git checkout -f "$RSKJ_BRANCH"
chmod +x ./configure.sh && chmod +x gradlew
./configure.sh

echo -e  "\n\n--------- Starting the configuration of powpeg ---------\n\n"
cd /usr/src/
if [ "$IS_POWPEG_BRANCH" -eq 200 ]; then
  echo "Found matching branch name in $REPO_OWNER/powpeg-node.git repo"
  git clone "https://github.com/$REPO_OWNER/powpeg-node.git" powpeg
else
  echo "Found matching branch name in rsksmart/powpeg-node.git repo"
  git clone "https://github.com/rsksmart/powpeg-node.git" powpeg
fi
cp configure_gradle_powpeg.sh powpeg
cd powpeg && git checkout -f "$POWPEG_NODE_BRANCH"
chmod +x ./configure.sh && chmod +x gradlew
POWPEG_VERSION=$(bash configure_gradle_powpeg.sh)
echo "POWPEG_VERSION=$POWPEG_VERSION"
./configure.sh
./gradlew  --info --no-daemon clean build -x test

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
npm run test-fail-fast
STATUS=$?

echo -e "\n\n--------- RIT Tests Result ---------\n\n"
if [ $STATUS -ne 0 ]; then
  MESSAGE="Rootstock Integration Tests Status: FAILED"
else
  MESSAGE="Rootstock Integration Tests Status: PASSED"
fi
echo -e "$MESSAGE"

echo "status=${STATUS}" >> "${GITHUB_OUTPUT}"
echo "message=${MESSAGE}" >> "${GITHUB_OUTPUT}"

if [ $STATUS -ne 0 ]; then
  exit 1
fi
exit 0