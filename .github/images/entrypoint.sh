#!/bin/bash

set -e

echo -e "\n\n--------- Starting the configuration of rskj ---------\n\n"

git clone https://github.com/rsksmart/rskj.git rskj
cd rskj && git checkout $RSKJ_BRANCH
chmod +x ./configure.sh && chmod +x gradlew
./configure.sh
./gradlew --no-daemon clean build -x test
cd ..

echo -e  "\n\n--------- Starting the configuration of powpeg ---------\n\n"
git clone https://github.com/rsksmart/powpeg-node.git powpeg
cp configure_gradle_federator.sh powpeg
cd powpeg && git checkout $FEDERATOR_BRANCH
chmod +x ./configure.sh && chmod +x gradlew
./configure_gradle_federator.sh
./configure.sh
./gradlew  --info --no-daemon clean build -x test

echo -e "\n\n--------- Starting the configuration of RIT ---------\n\n"
cd /usr/src/
git clone https://github.com/rsksmart/rootstock-integration-tests.git rit
mv configure_rit_locally.sh rit
mv regtest.js rit/config/regtest.js
mv /usr/src/logbacks/* /usr/src/rit/logbacks/
cd rit
git checkout $RIT_BRANCH
chmod +x ./configure.sh
./configure.sh
./configure_rit_locally.sh "$FED_VERSION"
export LOG_LEVEL=$RIT_LOG_LEVEL

echo -e "\n\n--------- Executing Rootstock Integration Tests ---------\n\n"
npm install -y
npm run test-fail-fast
STATUS=$?

if [ $STATUS -ne 0 ]; then
  echo -e "\n\n--------- RIT Tests failed ---------\n\n"
  MESSAGE="Rootstock Integration Tests Result: FAILED"
else
  echo -e "\n\n--------- RIT Tests passed ---------\n\n"
  MESSAGE="Rootstock Integration Tests Result: PASSED"
fi

# Write Results to the $GITHUB_OUTPUT file
echo "STATUS=$STATUS" >>"$GITHUB_OUTPUT"
echo "MESSAGE=$MESSAGE" >>"$GITHUB_OUTPUT"