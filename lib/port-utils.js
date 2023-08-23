var waitForPort = require('wait-for-port');
const net = require('net');

var waitForPortPromise = function(host, port, options) {
  return new Promise((resolve, reject) => {
    waitForPort(host, port, options || {}, (err) => {
      if (err) {
        reject(err);
      }

      resolve();
    })
  });
}

var waitForPorts = function(ports, options) {
  if (ports.length === 0) {
    return Promise.resolve();
  }

  var head = ports[0];
  var tail = ports.slice(1);
  return waitForPortPromise(head.host, head.port, options).then(() => waitForPorts(tail, options));
}

const isPortAvailable = (port, host, timeout) => {
  return new Promise(((resolve) => {
    const socket = new net.Socket();

    const onError = () => {
      socket.destroy();
      resolve(true);
    };

    socket.setTimeout(timeout);
    socket.once('error', onError);
    socket.once('timeout', onError);

    socket.connect(port, host, () => {
      socket.end();
      resolve(false);
    });
  }));
};

const findFreePorts = async (portRangeStart, portRangeEnd, amountOfPorts, host, timeout) => {
  host = host || '127.0.0.1';
  timeout = timeout || 1000;
  amountOfPorts = amountOfPorts || 1;
  let ports = [];
  for (let port = portRangeStart; port <= portRangeEnd; port++) {
    if (await isPortAvailable(port, host, timeout)) {
      ports.push(port);
      if (ports.length == amountOfPorts) {
        return ports;
      }
    }
  }
  return ports;
};

module.exports = {
  waitForPort: waitForPortPromise,
  waitForPorts: waitForPorts,
  findFreePorts: findFreePorts
}
