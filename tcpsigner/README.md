# Tcp signer bundle

This tcp signer bundle includes the built tcpsigner and tcp signer manager binaries, ready to be included in a Docker container and run.

The `Dockerfile` in this directory is to be used to run the tcp signer bundle manually for testing purposes.

To run the tcp signer bundle with docker, first execute:

> chmod +x run.sh

To build and run, try:

> ./run.sh -h

The `-h` parameter is to print the tcp signer `help` menu.

To run the tcp signer with some parameters, like the checkpoint (with `-c` flag), and port 9995 (or any other you need), try:

> ./run.sh -c0xf98c614b921913a70d36a68512e1bf3717a6ede3e05b9d1ab1fd8ba7bd0e9842 --difficulty=0x03 -p9995

You can also run another instance with a different port number, like:

> ./run.sh -c0xf98c614b921913a70d36a68512e1bf3717a6ede3e05b9d1ab1fd8ba7bd0e9842 --difficulty=0x03 -p9997

When running multiple instances of  the tcp signer, make sure to change the port number, to at least 2 units more. If the first instance has port 9995, then the second should be something like 9997, or any other number that is at least 2 units away. This is because the tcp signer will run with port `port - 1` while the tcp signer manager will run with `port`. Check the `entrypoint.sh` line with `TCP_SIGNER_PORT=$((PORT - 1))`.

This is to avoid ports collision when running multiple instances of the tcp signer directly from a docker container.

