const federationChangeTests = require('../lib/tests/change-federation');

federationChangeTests.execute('Initial Federation change from genesis to p2wsh', Runners.config.federations.secondFederation);
