var net = require('net');
var readline = require('readline');

var Client = function(host, port) {
  this.host = host;
  this.port = port;
};

Client.prototype.send = function(command) {
  return new Promise((resolve, reject) => {
    var socket = new net.Socket();
    socket.setTimeout(30000, () => reject('cant connect to socket'));
    socket.connect(this.port, this.host);
    socket.on('connect', () => {
      var socketRl = readline.createInterface({
        input: socket,
        output: socket,
      });

      let timeout = setTimeout(() => {
        socket.destroy();
        reject('Didnt get response from socket for command: ' + JSON.stringify(command));
      }, 30000);

      socketRl.question(JSON.stringify(command) + "\n", (response) => {
        clearTimeout(timeout);
        socket.destroy();
        resolve(JSON.parse(response));
      });
    });

    socket.on('error', reject);
  });
};

module.exports = {
  getClient: (host, port) => new Client(host, port),
};
