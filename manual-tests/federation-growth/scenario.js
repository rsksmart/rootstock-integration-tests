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
        'Grows the powpeg from 3 to 20 members through real Bridge federation changes. About an hour and a half on a developer laptop.',
    configFile: './config.js',
    bootstrapFile: '../lib/scenario-bootstrap.js',
    // Per test, not for the whole walk. The slowest single change measured twelve minutes, the
    // 16 member one, which spends most of that waiting out an SVP that will never finish. An
    // hour leaves room for a slower machine while still bounding a change that hangs.
    timeoutInMilliseconds: 60 * 60 * 1000,
};
