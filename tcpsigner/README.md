# Tcp signer bundle

This tcp signer bundle includes the built tcpsigner and tcp signer manager binaries (built on and to be used on Ubuntu 24), ready to be included in a Docker container and run.

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

When running multiple instances of  the tcp signer, make sure to change the port number, to at least 2 units more. If the first instance has port 9995, then the second should be something like 9997 or any other number that is at least 2 units away. This is because the tcp signer will run with port `port - 1` while the tcp signer manager will run with `port`. Check the `entrypoint.sh` line with `TCP_SIGNER_PORT=$((PORT - 1))`.

This is to avoid ports collision when running multiple instances of the tcp signer directly from a docker container.

You can also specify a `key.json` file. Just put one in the `tcpsigner/` base directory and run:

> ./run.sh -c0xf98c614b921913a70d36a68512e1bf3717a6ede3e05b9d1ab1fd8ba7bd0e9842 --difficulty=0x03 -p9995 --key=key.json

For the `key.json` file, you can paste something like this:

```json
{
    "m/44'/0'/0'/0/0": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4",
    "m/44'/1'/0'/0/0": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4",
    "m/44'/1'/0'/0/1": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4",
    "m/44'/1'/0'/0/2": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4",
    "m/44'/1'/1'/0/0": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4",
    "m/44'/1'/2'/0/0": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4",
    "m/44'/137'/0'/0/0": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4",
    "m/44'/137'/0'/0/1": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4",
    "m/44'/137'/1'/0/0": "e7272a960b8b7ca61b815b63d44db8f0aebd418e1613108027007a82541ac2f4"
}
```

If you don't pass a `--key` parameter, then the tcp signer will create a key file with random private keys that it will create.

You can call the `entrypoint.sh` file directly if you are running this project in Ubuntu.
