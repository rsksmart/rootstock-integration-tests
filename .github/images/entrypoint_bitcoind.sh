#!/bin/bash

/usr/local/bin/bitcoind -printtoconsole -regtest -debug -server -listen -port=$1 -connect=$2 -rpcbind=$3 -rpcallowip=$4 -rpcuser=$5 -rpcpassword=$6