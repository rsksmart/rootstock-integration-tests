const federationChangeTests = require('../../lib/tests/change-federation');

federationChangeTests.executeShort(
    '@smoke @regression @federation-change Initial Federation change from genesis to p2wsh',
    Runners.config.federations.secondFederation
);
