var childProcess = require('child_process');
var devnull = require('dev-null');
var portUtils = require('./port-utils');
var path = require('path');
let HsmClient = require('./hsm-client');
let { executeWithRetries } = require('./utils');
const fs = require('fs');

const VERSIONS = {
  V1: '1',
  V2: '2',
  V2_STATELESS: '2_stateless',
  V4: '4',
};

let HSM_IDENTIFIERS = 0;

let DEFAULT_HOSTS = {};
DEFAULT_HOSTS[VERSIONS.V1] = '127.0.0.1';
DEFAULT_HOSTS[VERSIONS.V2] = '0.0.0.0';

var DEFAULT_OPTIONS = {
  version: VERSIONS.V1,
  keyId: undefined
};

const spawnProcessVersion1 = (serverPath, port, keyPath) => {
  let args =  [
    serverPath,
    `-p${port}`
  ];
  if (keyPath) {
    args.push(`-k${path.resolve(keyPath)}`);
  }
  return childProcess.spawn('python', args);
};

/**
 * Converts a number to hex string. If the bytes number is odd, then it will be prepended with a 0 to make it even.
 * @param {Number} number 
 * @returns {string} hexResult
 */
const numberToHexString = (number) => {
  const hex = number.toString(16);
  // If the hex string length is odd, add a 0 to the beginning to make it even.
  const hexResult = hex.length % 2 ? '0' + hex : hex;
  return `0x${hexResult}`;
};

const spawnProcessVersion4Docker = async (
  serverPath, 
  port, 
  keyPath, 
  identifier,
  latestBlockHash, 
  difficultyTarget,
) => {

  if (!latestBlockHash) {
    throw new Error('to use HSM we need a checkpoint!');
  }

  const difficultyTargetInHexString = numberToHexString(difficultyTarget);
  const tmpKeyFile = `keys.json`;
  const containerName = `hsm-mware_${identifier}`;
  const copyKeyToPash = `${serverPath}/ledger/src/tcpsigner`;

  const dongleDockerArgs = [
    "run", "-i", "--rm", "--name", containerName, 
    "-v", `${serverPath}:/hsm4`, 
    "-v", "/dev/bus/usb:/dev/bus/usb", 
    "--privileged", 
    "-p", `${port}:9999`,
    "-w", "/hsm4/middleware", "hsm:mware", 
    "../ledger/src/tcpsigner/tcpsigner", 
    "-k", tmpKeyFile, 
    "-d", difficultyTargetInHexString, 
    "-c", latestBlockHash // Checkpoint
  ];

  const pythonManagerCommand = `docker exec -i ${containerName} python manager-tcp.py -b0.0.0.0`;

  const command = '/bin/sh';

  const processOptions = {
    cwd: path.dirname(serverPath),
  };

  if (keyPath) {
    childProcess.execSync(`cp ${path.resolve(keyPath)} ${copyKeyToPash}/${tmpKeyFile}`, processOptions);
  }

  const dongleProcess = childProcess.spawn("docker", dongleDockerArgs, processOptions);

  // We cannot spawn this process immediately after the docker container above is spawned because it might not be ready yet and an error can occur.
  // So we wait for the port to be ready before spawning the python manager process.
  await portUtils.waitForPort('localhost', port);

  const pythonManagerProcess = childProcess.spawn(command, ['-c', pythonManagerCommand], processOptions);

  const dongleLogs = fs.createWriteStream(`./logs/dongle.log`, {flags: 'a'});
  const managerLogs = fs.createWriteStream(`./logs/manager.log`, {flags: 'a'});

  dongleProcess.stdout.pipe(dongleLogs);
  pythonManagerProcess.stdout.pipe(managerLogs);

  return {
    containerName,
    dongleProcess,
    pythonManagerProcess
  };

};

const spawnProcessVersion2Docker = (
  serverPath, 
  port, 
  keyPath, 
  identifier, 
  forks, 
  latestBlockHash, 
  difficultyTarget,
  stateful,
  useLogger
) => {
  let tmpKeyFile = `keys.${identifier}.json`;
  let containerName = `hsm2_${identifier}`;
  let networkUpgrades = parseNetworkUpgrades(forks);
  if (!latestBlockHash) {
    throw new Error('to use HSM we need a checkpoint!');
  }
  let checkpoint = latestBlockHash;
  let dockerCommand = 
    `docker run -i --rm --name ${containerName} ` + 
    `-p ${port}:${port} ` + 
    `-v "\`pwd\`:/hsm2" ` + 
    `-w "/hsm2" ` + 
    `-u "\`id -u\`:\`id ` + 
    `-g\`" hsm2 ./${path.basename(serverPath)} ` + 
    `-b 0.0.0.0 ` +
    `-p ${port} `+ 
    `-k ${tmpKeyFile} ` + 
    `-n '${networkUpgrades}' `;
  if (stateful) {
    dockerCommand += 
    `-c '${checkpoint}' ` +
    `-d '0x${difficultyTarget.toString(16)}' ` +
    `-s 'state_${identifier}.json' ` +
    `-S 20480 `;
  }
  if (useLogger) {
    dockerCommand += `-l 'logging-custom.cfg'`; // enable to configure custom logging. File must exist in simulator directory
  }
  //TODO Allow parametrization of custom logging file
  let args =  [
    '-c',
    dockerCommand
  ];
  const processOptions = { 
    cwd: path.dirname(serverPath), 
    //  stdio: 'inherit' //==> uncomment if you need to see what's going on in the spawned process
  };
  if (keyPath) {
    childProcess.execSync(`cp ${path.resolve(keyPath)} ${tmpKeyFile}`, processOptions);
    
    // Remove this tmp file after 10 seconds. If the hsm has not fetched the file at that time, it won't anyway
    setTimeout(() => {
      childProcess.execSync(`rm -f ${tmpKeyFile}`, processOptions);
    }, 10000);
  }
  const command = '/bin/sh';
  let process = childProcess.spawn(command, args, processOptions);
  process.containerName = containerName;
  return process;
};

const spawnProcessVersion2NoDocker = (
  serverPath, 
  port, 
  keyPath, 
  identifier, 
  forks, 
  checkpoint, 
  difficultyTarget,
  stateful
) => {
  let tmpKeyFile = `keys.${identifier}.json`;
  let containerName = `hsm2_${identifier}`;
  let networkUpgrades = parseNetworkUpgrades(forks);
  let args =  [
    '-b127.0.0.1',
    `-p${port}`, 
    `-k${tmpKeyFile}`,
    `-n${networkUpgrades}`,
    `-S20480`,
    //`-l logging-custom.cfg`; // enable to configure custom logging. File must exist in simulator directory
    //TODO Allow parametrization of custom logging file
  ];
  if (stateful) {
    args = args.concat([
      `-c${checkpoint}`,
      `-d0x${difficultyTarget.toString(16)}`,
      `-sstate_${identifier}.json`  // Set a fake state file 
    ]);
  }

  const processOptions = { 
    cwd: path.dirname(serverPath), 
    //  stdio: 'inherit' //==> uncomment if you need to see what's going on in the spawned process
  };
  if (keyPath) {
    childProcess.execSync(`cp ${path.resolve(keyPath)} ${tmpKeyFile}`, processOptions);
    
    // Remove this tmp file after 10 seconds. If the hsm has not fetched the file at that time, it won't anyway
    setTimeout(() => {
      childProcess.execSync(`rm -f ${tmpKeyFile}`, processOptions);
    }, 10000);
  }
  let process = childProcess.spawn(serverPath, args, processOptions);
  process.containerName = containerName;
  return process;
};

let parseNetworkUpgrades = (forks) => {
  let upgrades = {};
  Object.values(forks).map(f => upgrades[f.name] = f.activationHeight);
  let networkUpgrades = {network_upgrades:upgrades}
  return JSON.stringify(networkUpgrades);
};

var HSMRunner = function(options) {
  console.log('HSMRunner constructor options: ', options);
  this.options = Object.assign({}, options);
  if (!this.options.version) {
    this.options.version = DEFAULT_OPTIONS.version;
  }
  if (!this.options.host) {
    this.options.host = DEFAULT_HOSTS[this.options.version];
  }

  this.identifier = (new Date()).getTime() + HSM_IDENTIFIERS;
  HSM_IDENTIFIERS++;
}


HSMRunner.prototype.spawnProcess = async function() {
  switch (this.options.version) {
    case VERSIONS.V1:
      return spawnProcessVersion1(this.options.serverPath, this.port, this.options.keyPath);
    case VERSIONS.V2:
    case VERSIONS.V2_STATELESS:
      if (this.options.useDocker) {
        return spawnProcessVersion2Docker(
          this.options.serverPath, 
          this.port, 
          this.options.keyPath, 
          this.identifier, 
          this.options.forks, 
          this.options.latestBlockHash,
          this.options.difficultyTarget,
          this.options.version == VERSIONS.V2,
          this.options.useLogger
        );
      } else {
        return spawnProcessVersion2NoDocker(
          this.options.serverPath,
          this.port,
          this.options.keyPath,
          this.identifier,
          this.options.forks,
          this.options.latestBlockHash,
          this.options.difficultyTarget,
          this.options.version == VERSIONS.V2
        );
      }
    case VERSIONS.V4:
      const hsmV4Response = await spawnProcessVersion4Docker(
        this.options.serverPath, 
        this.port, 
        this.options.keyPath, 
        this.identifier, 
        this.options.latestBlockHash,
        this.options.difficultyTarget,
        this.options.forks,
      );
      this.containerName = hsmV4Response.containerName;
      return hsmV4Response.dongleProcess;
    default:
      throw new Error(`invalid version ${this.options.version}`);
  }
}

HSMRunner.prototype.start = function() {
  if (this.isRunning()) {
    throw "HSM already started";
  }

  if (this.options.serverPath == null) {
    throw "Must specify a path for the HSM server";
  }
  this.options.serverPath = path.resolve(this.options.serverPath);

  var futurePort = Promise.resolve();
  if (!this.options.port) {
    futurePort = portUtils.findFreePorts(40000, 40100, 1, this.options.host);
  }

  return futurePort.then((selectedPorts) => {
    this.port = this.options.port;
    if (!this.port) {
      this.port = selectedPorts[0];
    }

    return this.spawnProcess().then(process => {
      this.process = process;
      if (this.process.stdout) {
        if (this.options.stdout != null) {
          this.process.stdout.pipe(this.options.stdout);
        } else {
          this.process.stdout.pipe(devnull());
        }
      }
  
      if (this.process.stderr) {
        if (this.options.stderr != null) {
          this.process.stderr.pipe(this.options.stderr);
        } else {
          this.process.stderr.pipe(devnull());
        }
      }
  
      this.running = false;
  
      this.process.on('exit', () => {
        this.running = false;
      });

      this.client = HsmClient.getClient('localhost', this.port);
  
      return executeWithRetries(
        () => {
          return this.getPublicKey();
        },
        10,
        1000).then((r) => {
          this.running = true;
          return r;
        });
      });
    });
};

HSMRunner.prototype.stop = function() {
  if  (this.process == null) {
    throw "HSM server was not started";
  }
  this.process.kill('SIGINT');
  if(this.containerName) {
    childProcess.execSync(`docker stop ${this.containerName}`);
  }
};

HSMRunner.prototype.isRunning = function() {
  return this.running;
};

HSMRunner.prototype.getPid = function() {
  if (!this.isRunning()) {
    return false;
  }

  return this.process.pid;
}

HSMRunner.prototype.getPublicKey = function(keyId) {
  let keyIdArg = keyId || this.options.keyId;
  return this.client.getPublicKey(keyIdArg);
}

HSMRunner.prototype.getKeyId = function() {
  return this.options.keyId;
}

module.exports = {
  Runner: HSMRunner
};
