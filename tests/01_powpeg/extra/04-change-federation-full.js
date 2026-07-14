const federationChangeTests = require('../../lib/tests/change-federation');

federationChangeTests.executeFull(
    'Full Federation change from p2wsh to third federation with all intermediate validations',
    Runners.config.federations.thirdFederation
);
