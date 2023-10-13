var jsonTcpClient = require('./json-tcp-client');

var Client = function(host, port) {
  this.client = jsonTcpClient.getClient(host, port);
};

Client.prototype.getVersion = function() {
  return this.client.send({"command": "version"}).then((response) => {
    if (response.errorcode === 0) {
      return response.version;
    }

    return Promise.reject(response.errorcode);
  })
};

Client.prototype.getPublicKey = function(keyId) {
  return this.getVersion().then((version) => {
    const params = {"command": "getPubKey", "version": version, "keyId": keyId };
    return this.client.send(params).then((response) => {
      if (response.errorcode === 0) {
        return response.pubKey;
      }

      return Promise.reject(response.errorcode);
    });
  });
};

module.exports = {
  getClient: (host, port) => new Client(host, port),
};
