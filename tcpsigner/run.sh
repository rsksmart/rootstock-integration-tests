#!/bin/bash

PORT=9999
while getopts ":p:" opt; do
    case "$opt" in # NOSONAR
    p)
        PORT=$OPTARG 
        ;;
    *)
        # NOSONAR: Unknown options are silently ignored; legitimate pass-through arguments are handled after getopts
        ;;
    esac
done

DOCKER_CONTAINER_NAME="tcpsigner-bundle"
NEW_ARGS=()

for arg in "$@"; do
  if [[ "$arg" == --docker-container-name=* ]]; then
    DOCKER_CONTAINER_NAME="${arg#--docker-container-name=}"
  else
    NEW_ARGS+=("$arg")
  fi
done

DOCKER_IMAGE_NAME=tcpsigner-bundle

docker buildx build --platform linux/amd64 -t $DOCKER_IMAGE_NAME .

docker run --name $DOCKER_CONTAINER_NAME --platform linux/amd64 -ti --rm -p $PORT:$PORT $DOCKER_IMAGE_NAME ./entrypoint.sh -p$PORT "${NEW_ARGS[@]}"
