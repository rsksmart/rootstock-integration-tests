#!/bin/bash

set -e

RSKJ_BRANCH="master"
POWPEG_BRANCH="master"


#Start bitcoind in regtest mode
echo "Starting  the bitcoin daemon on regtest mode configured to execute RIT"
bitcoind -deprecatedrpc=generate -addresstype=legacy -regtest -printtoconsole -server -rpcuser=rsk -rpcpassword=rsk -rpcport=18332 -txindex -datadir=/usr/src/bitcoindata &

# Pause for 20 seconds
echo "--------- Waiting a bit the daemon to startup---------"
sleep 10

# Generate 200 blocks
echo "--------- Generating 200 blocks to execute tests ---------"
bitcoin-cli -regtest -rpcport=18332 -rpcuser=rsk -rpcpassword=rsk generate 200

echo "--------- Finished the bitcoin daemon configuration ---------"
echo " JAVA_HOME: $JAVA_HOME"
echo "--------- Starting the configuration of rskj ---------"

git clone https://github.com/rsksmart/rskj.git rskj
cd rskj && git checkout $RSKJ_BRANCH
chmod +x ./configure.sh && chmod +x gradlew
./configure.sh
./gradlew --no-daemon clean build -x test
cd ..

echo "--------- Starting the configuration of powpeg ---------"
git clone https://github.com/rsksmart/powpeg-node.git powpeg
cp configure_gradle_federator.sh powpeg
cd powpeg && git checkout $POWPEG_BRANCH
chmod +x ./configure.sh && chmod +x gradlew
FED_VERSION=$(bash configure_gradle_federator.sh)
./configure.sh
./gradlew  --info --no-daemon clean build -x test

echo "--------- Starting the configuration of RIT ---------"
cd /usr/src/
git clone https://github.com/rsksmart/rootstock-integration-tests.git rit
cp configure_rit_locally.sh rit
cd rit
chmod +x ./configure.sh
./configure.sh
./configure_rit_locally.sh

# Keep the container running
tail -f /dev/null
