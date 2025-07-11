const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { wait } = require('./utils');
const jsonTcpClient = require('./json-tcp-client');

const TCP_SIGNER_HOST = '127.0.0.1';

const keyIds = [
  "m/44'/1'/0'/0/0", // tBTC
  "m/44'/1'/1'/0/0", // tRSK
  "m/44'/1'/2'/0/0" // tMST
];

class TcpSignerRunner {

  constructor(id, port, extraArgs = []) {
    this.id = id;
    this.dockerContainerName = `${this.id}-hsm`;
    this.port = port;
    this.extraArgs = extraArgs;
    this.process = null;
    this.dockerImage = 'tcpsigner-bundle';
    this.execEnv = process.env.EXEC_ENV || 'UBUNTU';
    this.client = jsonTcpClient.getClient(TCP_SIGNER_HOST, this.port);
    this.isRunning = false;
  }

  async start() {
    
    if(this.isRunning) {
      throw new Error(`TcpSignerRunner "${this.dockerContainerName}" is already running`);
    }

    const args = [
      ...this.extraArgs,
      `-p${this.port}`,
      `--key=key.json`,
    ];

    const tcpSignerExecutionPath = path.resolve(__dirname, '../tcpsigner');
    const keyPath = path.resolve(tcpSignerExecutionPath, `keys/${this.id}-key.json`);

    const destination = path.join(tcpSignerExecutionPath, 'key.json');
    fs.copyFileSync(keyPath, destination);

    const runningInMacOS = this.execEnv === 'MACOS';

    const scriptPath = runningInMacOS ? path.resolve(tcpSignerExecutionPath, 'run.sh') : path.resolve(tcpSignerExecutionPath, 'entrypoint.sh');

    if(runningInMacOS) {
      args.push(`--docker-container-name=${this.dockerContainerName}`);
    }

    const processOptions =  { cwd: tcpSignerExecutionPath, stdio: 'inherit' };
    this.process = spawn(scriptPath, args, processOptions);

    this.process.on('exit', () => {
      console.log(`TcpSignerRunner has stopped.`);
      this.isRunning = false;
    });

    this.isRunning = true;

    await this.waitForReady();

    return this.process;
    
  }

  async waitForReady() {

    let attempts = 0;
    const maxAttempts = 25;
    const waitTime = 1000;

    while (attempts < maxAttempts) {
      try {
        const versionResponseFromTcpSigner = await this.getVersion();
        console.log('Tcp Signer is ready. Version: ', versionResponseFromTcpSigner);
        break;
      } catch (err) {
        attempts++;
        if (attempts === maxAttempts) {
          const message = `Failed to connect to instance "${this.dockerContainerName}" after ${maxAttempts} attempts.`;
          console.error(message);
          throw new Error(message);
        }
        await wait(waitTime);
      }
    }

  }
 
  stop() {
    if (!this.process) {
      return;
    }
    try {
      const runningInMacOS = this.execEnv === 'MACOS';
      if(runningInMacOS) {
        execSync(`docker stop ${this.dockerContainerName}`, { stdio: 'inherit' });
      }
      this.process.kill('SIGKILL');
      this.process = null;
      this.isRunning = false;
    } catch (err) {
      console.error(`Failed to stop instance "${this.dockerContainerName}":`, err.message);
    }
  }

  async getVersion() {
    if(!this.isRunning) {
      return -1;
    }
    try {
      const response = await this.client.send({ command: "version" });
      if (response.errorcode === 0) {
          return response.version;
      }
    } catch (err) {
      throw new Error(`Failed to get version from instance "${this.dockerContainerName}": ${err.message}`);
    }
  }

  async getPublicKey(keyId) {
    if(!this.isRunning) {
      return [];
    }
    try {
      const version = await this.getVersion();
      const response = await this.client.send({ command: "getPubKey", version: version, keyId: keyId });
      if (response.errorcode === 0) {
        return response.pubKey;
      }
    } catch(err) {
      console.error('Error getting public key: ', err.message);
      throw new Error(`Failed to get public key from instance "${this.dockerContainerName}": ${err.message}`);
    }
  }

  async getPublicKeys() {
    const promises = keyIds.map(keyId => this.getPublicKey(keyId));
    return Promise.all(promises);
  }

  async getBlockchainState() {
    if(!this.isRunning) {
      return null;
    }
    try {
      const version = await this.getVersion();
      const response = await this.client.send({ command: "blockchainState", version: version });
      if (response.errorcode === 0) {
        return response.state;
      }
    } catch (err) {
      console.error('Error getting blockchain state: ', err.message);
    }
    return null;
  }
  
}

module.exports = TcpSignerRunner;
