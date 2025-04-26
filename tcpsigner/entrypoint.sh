#!/bin/bash

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

help() {
    "$DIR/bin/tcpsigner" --help
    exit 1
}

stop() {
   exit
}

trap stop SIGTERM SIGINT SIGQUIT SIGHUP ERR

# ==========================================================
# ==========================================================
while getopts ":p:h" opt; do
    case "$opt" in
    p)
        PORT=$OPTARG 
        ;;
    h)
        help
        ;;
    esac
done
# ==========================================================
# ==========================================================

TCP_SIGNER_PORT=$((PORT - 1))

# Start the TCPSigner
"$DIR/bin/tcpsigner" $@ -p"$TCP_SIGNER_PORT" > ./tcpsigner.log 2>&1 &

# Wait for it to be up and running
sleep 5
  
# Start the manager for the TCPSigner
"$DIR/bin/manager-tcp" -b0.0.0.0 -p$PORT -tp $TCP_SIGNER_PORT > ./tcpsigner-manager.log 2>&1 &
  
# Wait for any process to exit
wait -n
  
# Exit with status of process that exited first
exit $?
