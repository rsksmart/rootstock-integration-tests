const { spawn } = require('child_process');
const path = require('path');

const runningInstances = new Map();

/**
 * Starts a new tcpsigner instance.
 * @param {string} id - A unique ID to reference this instance.
 * @param {number|string} port - The port to bind the manager to.
 * @param {string[]} extraArgs - Any extra arguments for tcpsigner.
 * @returns {number|null} PID of the started process.
 */
function startTcpsignerInstance(id, port, extraArgs = []) {

  if (runningInstances.has(id)) {
    console.warn(`Instance with ID "${id}" is already running.`);
    return null;
  }

  const scriptPath = path.resolve(__dirname, '../tcpsigner/entrypoint.sh');
  console.log('scriptPath: ', scriptPath);
  const args = [`-p${port}`, ...extraArgs];

  const child = spawn(scriptPath, args, {
    stdio: 'inherit',
    cwd: path.resolve('tcpsigner'),
  });

  console.log('child: ', child);

  runningInstances.set(id, child.pid);

  console.log(`✅ Started instance "${id}" on port ${port} (PID: ${child.pid})`);
  return child.pid;
}

/**
 * Stops a running instance.
 * @param {string} id - The ID of the instance to stop.
 */
function stopTcpsignerInstance(id) {
  const pid = runningInstances.get(id);
  if (!pid) {
    console.warn(`⚠️ No instance found with ID "${id}".`);
    return;
  }

  try {
    process.kill(pid, 'SIGTERM');
    runningInstances.delete(id);
    console.log(`🛑 Stopped instance "${id}" (PID: ${pid})`);
  } catch (err) {
    console.error(`❌ Failed to stop instance "${id}":`, err.message);
  }

}

/**
 * Stops all running tcpsigner instances.
 */
function stopAllTcpsignerInstances() {
  for (const [id, pid] of runningInstances.entries()) {
    try {
      process.kill(pid, 'SIGTERM');
      console.log(`🛑 Stopped instance "${id}" (PID: ${pid})`);
    } catch (err) {
      console.error(`❌ Failed to stop instance "${id}" (PID: ${pid}):`, err.message);
    }
  }
  runningInstances.clear();
}

module.exports = {
  startTcpsignerInstance,
  stopTcpsignerInstance,
  stopAllTcpsignerInstances,
};
