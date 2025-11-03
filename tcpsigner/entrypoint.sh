#!/bin/bash

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

help() {
    "$DIR/bin/tcpsigner" --help
    return 1
}

stop() {
   exit
   return 0
}

trap stop SIGTERM SIGINT SIGQUIT SIGHUP ERR

# ==========================================================
# ==========================================================
while getopts ":p:h" opt; do
    case "$opt" in # NOSONAR
    p)
        PORT=$OPTARG 
        ;;
    h)
        help
        ;;
    *)
        echo "Invalid option: -$OPTARG" >&2
        exit 1
        ;;
    esac
done
# ==========================================================
# ==========================================================

TCP_SIGNER_PORT=$((PORT - 1))

# 🔵 Check if manager-tcp binary exists. Necessary when running without Docker.
if [[ ! -f "$DIR/bin/manager-tcp" ]]; then
  tar xzf "$DIR/bin/manager-tcp.tgz" -C "$DIR/bin/"
fi

chmod +x $DIR/bin/tcpsigner
chmod +x $DIR/bin/manager-tcp

chmod 444 $DIR/key.json

# Start the TCPSigner
"$DIR/bin/tcpsigner" $@ -p$TCP_SIGNER_PORT > $DIR/tcpsigner.log 2>&1 &

# Wait for it to be up and running
sleep 2
  
# Start the manager for the TCPSigner
"$DIR/bin/manager-tcp" -b0.0.0.0 -p$PORT -tp $TCP_SIGNER_PORT > $DIR/tcpsigner-manager.log 2>&1 &
  
# Wait for any process to exit
wait -n
  
# Exit with status of process that exited first
exit $?
