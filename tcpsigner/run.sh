#!/bin/bash

PORT=9999
while getopts ":p:" opt; do
    case "$opt" in
    p)
        PORT=$OPTARG 
        ;;
    esac
done

echo "Parameters: $@"

DOCKNAME=tcpsigner-bundle

echo "The port $PORT"

docker buildx build --platform linux/amd64 -t $DOCKNAME .

docker run --platform linux/amd64 -ti --rm -p $PORT:$PORT $DOCKNAME ./entrypoint.sh -p$PORT $@
