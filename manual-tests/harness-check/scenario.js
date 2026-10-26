/**
 * The smallest possible scenario. It starts nothing and only checks the manual test harness
 * itself, so it finishes in seconds.
 *
 * It doubles as the template for a new scenario: create a folder next to this one, give it a
 * `scenario.js` like this, and add spec files whose names start with a number.
 *
 * Manifest fields, all optional except `description`:
 *   description            one line, shown when listing the scenarios
 *   timeoutInMilliseconds  mocha timeout, defaults to 4 hours
 *   configFile             node configuration, relative to the scenario folder, exported to the
 *                          spec files as CONFIG_FILE_PATH the same way `test.js` reads it
 *   bootstrapFile          loaded by mocha before the specs, for root level before/after hooks
 */
module.exports = {
    description: 'Checks the manual test harness itself. Starts no nodes, runs in seconds.',
    timeoutInMilliseconds: 30000,
};
