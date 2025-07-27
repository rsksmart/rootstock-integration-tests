const unionBridgeTests = require('../lib/tests/union-bridge-methods');
const activateForkTest = require("../lib/tests/activate-fork");

(async () => {
  await activateForkTest.execute(
    Runners.common.forks.reed800
  );
  await unionBridgeTests.execute('Union Bridge functionality tests');
})();
