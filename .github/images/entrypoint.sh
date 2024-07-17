#!/bin/bash

set -e

echo -e "\n\n--------- Starting the configuration of rskj ---------\n\n"
cd /usr/src/
git clone https://github.com/rsksmart/rskj.git rskj
cd rskj && git checkout "${INPUT_RSKJ_BRANCH}"
chmod +x ./configure.sh && chmod +x gradlew
./configure.sh

echo -e  "\n\n--------- Starting the configuration of powpeg ---------\n\n"
cd /usr/src/
git clone https://github.com/rsksmart/powpeg-node.git powpeg
cp configure_gradle_powpeg.sh powpeg
cd powpeg && git checkout "${INPUT_POWPEG_NODE_BRANCH}"
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
git checkout "${INPUT_RIT_BRANCH}"
chmod +x ./configure.sh
./configure.sh
./configure_rit_locally.sh "${POWPEG_VERSION}"
export LOG_LEVEL="${INPUT_RIT_LOG_LEVEL}"

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

echo "status=${STATUS}" >> ${GITHUB_OUTPUT}
echo "message=${MESSAGE}" >> ${GITHUB_OUTPUT}

if [ $STATUS -ne 0 ]; then
  exit 1
fi
exit 0