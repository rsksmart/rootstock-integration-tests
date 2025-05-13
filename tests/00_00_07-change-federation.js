const federationChangeTests = require('../lib/tests/change-federation');

federationChangeTests.execute('Initial Federation change', Runners.config.federations.secondFederation);
