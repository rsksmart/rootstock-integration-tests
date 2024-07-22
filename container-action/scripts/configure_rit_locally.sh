#!/bin/bash

if [ $# -ne 1 ] || [ -z "${1:-}" ]; then
    echo "Usage: ${0##*/} POWPEG_VERSION" >&2
    exit 1
fi
POWPEG_VERSION=$1
shift
echo "POWPEG_VERSION received as parameter: $1"

read -r -d '' SETTINGS_RIT <<EOF
POWPEG_NODE_JAR_PATH=/usr/src/powpeg/build/libs/federate-node-$POWPEG_VERSION-all.jar
CONFIG_FILE=/usr/src/rit/config/regtest.js
LOG_HOME=/usr/src/rit/logs
BITCOIND_BIN_PATH=/usr/local/bin/bitcoind
BITCOIN_DATA_DIR=/usr/src/bitcoindata
WAIT_FOR_BLOCK_ATTEMPT_TIME_MILLIS=800
WAIT_FOR_BLOCK_MAX_ATTEMPTS=1200
EOF

echo -e  "\n\n---------- Configuring RIT to run the tests locally -----------\n\n"
echo -e "$SETTINGS_RIT" > .env
