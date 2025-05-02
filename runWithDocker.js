const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config();

const jarPath = process.env.POWPEG_NODE_JAR_PATH;
const removeContainerAfterExecution = process.env.DOCKER_REMOVE_CONTAINER_AFTER_EXECUTION === 'true';

const removeContainerAfterExecutionFlag = removeContainerAfterExecution ? '--rm' : '';

if (jarPath) {
  const destPath = path.join(__dirname, 'federate-node.jar');
  console.log(`Copying JAR from ${jarPath} to ${destPath}`);
  fs.copyFileSync(jarPath, destPath);
} else {
  console.log("POWPEG_NODE_JAR_PATH is not set. Skipping file copy.");
}

console.log("Building Docker image...");

execSync('docker buildx build --platform linux/amd64 -t rits .', { stdio: 'inherit' });

console.log("Running Docker container...");

execSync(`docker run --name rits --platform linux/amd64 -it ${removeContainerAfterExecutionFlag} rits`, { stdio: 'inherit' });
