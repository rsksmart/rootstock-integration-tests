chmod 400 config/node-keys/genesis-federation/fed1.key
chmod 400 config/node-keys/genesis-federation/fed2.key
chmod 400 config/node-keys/genesis-federation/fed3.key

chmod 400 config/node-keys/second-federation/fed1.key
chmod 400 config/node-keys/second-federation/fed2.key
chmod 400 config/node-keys/second-federation/fed3.key

chmod 400 config/node-keys/third-federation/fed1.key
chmod 400 config/node-keys/third-federation/fed2.key
chmod 400 config/node-keys/third-federation/fed3.key

tar xzf tcpsigner/bin/manager-tcp.tgz -C tcpsigner/bin/

chmod +x tcpsigner/entrypoint.sh
chmod +x tcpsigner/bin/tcpsigner
chmod +x tcpsigner/bin/manager-tcp
