const federationChangeTests = require('../lib/tests/change-federation');

const makeDonationPegins = true;

federationChangeTests.execute('Initial Federation change', Runners.config.federations.secondFederation, makeDonationPegins);
