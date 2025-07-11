const federationChangeTests = require('../lib/tests/change-federation');

federationChangeTests.execute('Initial Federation change from genesis to p2sh', Runners.config.federations.secondFederation);
