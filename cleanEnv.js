const fs = require('node:fs');
const path = require('node:path');
const shell = require('shelljs');
require('dotenv').config();

// To stop hanging federate nodes and bitcoind instances.
const killServicesCommand = "kill $(ps -A | grep -e java -e bitcoind | awk '{print $1}')";

async function clearLogFiles(directory) {
  try {
    const files = await fs.promises.readdir(directory, { withFileTypes: true });

    for (const file of files) {
      const filePath = path.join(directory, file.name);

      if (file.isDirectory()) {
        await clearLogFiles(filePath);
      } else if (path.extname(file.name) === ".log") {
        await fs.promises.truncate(filePath, 0);
        console.log(`Cleared content of file: ${filePath}`);
      }
    }
  } catch (err) {
    console.error(`Error processing directory ${directory}: ${err.message}`);
  }
}

function clearBitcoinDataDirectory() {
  return new Promise((resolve, reject) => {
    const directory = process.env.BITCOIN_DATA_DIR;

    if (!directory) {
      return reject(new Error("BITCOIN_DATA_DIR is not set."));
    }

    fs.readdir(directory, (err, files) => {
      if (err) {
        return reject(new Error(`Error reading directory ${directory}: ${err.message}`));
      }

      const deletePromises = files.map(file => {
        const filePath = path.join(directory, file);
        return fs.promises.rm(filePath, { recursive: true, force: true });
      });

      Promise.all(deletePromises)
        .then(() => {
          console.log(`Successfully cleared contents of: ${directory}`);
          resolve();
        })
        .catch(reject);
    });
  });
}
const cleanEnvironment = async () => {
    console.info('Cleaning environment...');
    await clearBitcoinDataDirectory();
    await clearLogFiles(process.env.LOG_HOME || './logs');
    shell.exec(killServicesCommand);
    console.info('Environment cleaned.');
};

cleanEnvironment();
