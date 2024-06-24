#!/bin/bash

set -e

RSKJ_BRANCH="master"
POWPEG_BRANCH="master"


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
cd powpeg && git checkout $POWPEG_BRANCH
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
chmod +x ./configure.sh
./configure.sh
./configure_rit_locally.sh "$FED_VERSION"

echo -e "\n\n--------- Executing Rootstock Integration Tests ---------\n\n"
npm install -y
npm run test-fail-fast

# Keep the container running
tail -f /dev/null
