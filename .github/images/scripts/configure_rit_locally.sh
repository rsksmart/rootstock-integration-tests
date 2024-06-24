#!/bin/bash

POWPEG_VERSION="SNAPSHOT-6.3.0.0"

read -r -d '' SETTINGS_RIT <<EOF
POWPEG_NODE_JAR_PATH=/usr/src/powpeg/build/libs/federate-node-$POWPEG_VERSION-all.jar
CONFIG_FILE=/usr/src/rit/config/regtest.js
LOG_HOME=/usr/src/rit/logs
BITCOIND_BIN_PATH=/usr/local/bin/bitcoind
BITCOIN_DATA_DIR=/usr/src/rit/bitcoindata
EOF

echo "Configuring RIT to run the tests"
echo "Adding the environment content locally"
echo -e "$SETTINGS_RIT" > .env



