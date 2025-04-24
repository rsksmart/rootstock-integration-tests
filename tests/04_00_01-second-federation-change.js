const federationChangeTests = require('../lib/tests/change-federation');

federationChangeTests.execute('Second Federation change', Runners.config.federations.thirdFederation); // First svp federation change
