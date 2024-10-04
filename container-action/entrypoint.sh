#!/bin/sh -l

set -e
RSKJ_BRANCH="${INPUT_RSKJ_BRANCH}"
POWPEG_NODE_BRANCH="${INPUT_POWPEG_NODE_BRANCH}"
RIT_BRANCH="${INPUT_RIT_BRANCH}"
LOG_LEVEL="${INPUT_RIT_LOG_LEVEL}"
REPO_OWNER="${INPUT_REPO_OWNER:-rsksmart}"  # Default to 'rsksmart' if not provided
IS_RSKJ_BRANCH=$(git ls-remote "https://github.com/$REPO_OWNER/rskj.git" "$RSKJ_BRANCH")
IS_POWPEG_BRANCH=$(git ls-remote "https://github.com/$REPO_OWNER/powpeg-node.git" "$POWPEG_NODE_BRANCH")

echo -e "\n\n--------- Input parameters received ---------\n\n"
echo "RSKJ_BRANCH=$RSKJ_BRANCH"
echo "POWPEG_NODE_BRANCH=$POWPEG_NODE_BRANCH"
echo "RIT_BRANCH=$RIT_BRANCH"
echo "LOG_LEVEL=$LOG_LEVEL"
echo "REPO_OWNER=$REPO_OWNER"

echo -e "\n\n--------- Starting the configuration of rskj ---------\n\n"
cd /usr/src/
if test -n "${IS_RSKJ_BRANCH}"; then
  echo "Found matching branch name in $REPO_OWNER/rskj.git repo"
  git clone "https://github.com/$REPO_OWNER/rskj.git" rskj
else
  echo "Found matching branch name in rsksmart/rskj.git repo"
  git clone "https://github.com/rsksmart/rskj.git" rskj
fi
cd rskj && git checkout "$RSKJ_BRANCH"
chmod +x ./configure.sh && chmod +x gradlew
./configure.sh

echo -e  "\n\n--------- Starting the configuration of powpeg ---------\n\n"
cd /usr/src/
if test -n "${IS_POWPEG_BRANCH}"; then
  echo "Found matching branch name in $REPO_OWNER/powpeg-node.git repo"
  git clone "https://github.com/$REPO_OWNER/powpeg-node.git" powpeg
else
  echo "Found matching branch name in rsksmart/powpeg-node.git repo"
  git clone "https://github.com/rsksmart/powpeg-node.git" powpeg
fi
cp configure_gradle_powpeg.sh powpeg
cd powpeg && git checkout "$POWPEG_NODE_BRANCH"
chmod +x ./configure.sh && chmod +x gradlew
POWPEG_VERSION=$(bash configure_gradle_powpeg.sh)
echo "POWPEG_VERSION=$POWPEG_VERSION"
./configure.sh
./gradlew  --info --no-daemon clean build -x test

echo -e "\n\n--------- Starting the configuration of RIT ---------\n\n"
cd /usr/src/
git clone https://github.com/rsksmart/rootstock-integration-tests.git rit
mv configure_rit_locally.sh rit
mv regtest.js rit/config/regtest.js
mv /usr/src/logbacks/* /usr/src/rit/logbacks/
cd rit
git checkout "$RIT_BRANCH"
chmod +x ./configure.sh
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