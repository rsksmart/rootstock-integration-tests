/**
 * Walks the powpeg from the 3 member regtest genesis federation up to 20 members, one federation
 * change at a time, and checks what the Bridge can and cannot build along the way.
 *
 * Every federation reuses the previous one's members and adds one more, so the nodes that are
 * already running stay running: a node is only ever added, never stopped. Only half of the
 * members plus one actually run as nodes, which is all the Bridge needs signatures from, so the
 * machine tops out at 11 JVMs at the very end instead of 20.
 */
module.exports = {
    description:
        'Grows the powpeg from 3 to 20 members through real Bridge federation changes. Takes hours.',
    configFile: './config.js',
    bootstrapFile: '../lib/scenario-bootstrap.js',
    // Each federation change needs around 315 rsk blocks before the next one can start: 150 to
    // activate, 15 to open the migration window and 150 to retire the old federation, all
    // hardcoded in rskj's FederationRegTestConstants. Times seventeen changes, plus the SVP of
    // each one, this runs for hours.
    timeoutInMilliseconds: 8 * 60 * 60 * 1000,
};
