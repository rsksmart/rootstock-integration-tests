const fs = require('fs');
const path = require('path');
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

function deleteBitcoinDataDirectory() {
  return new Promise((resolve, reject) => {
    const directory = process.env.BITCOIN_DATA_DIR;

    if (!directory) {
      return reject(new Error("BITCOIN_DATA_DIR is not set."));
    }

    fs.rm(directory, { recursive: true, force: true }, (err) => {
      if (err) {
        reject(new Error(`Error deleting directory ${directory}: ${err.message}`));
      } else {
        console.log(`Successfully deleted directory: ${directory}`);
        resolve();
      }
    });
  });
}

const cleanEnvironment = async () => {
    console.info('Cleaning environment...');
    await deleteBitcoinDataDirectory();
    await clearLogFiles(process.env.LOG_HOME);
    shell.exec(killServicesCommand);
    console.info('Environment cleaned.');
};

cleanEnvironment();
