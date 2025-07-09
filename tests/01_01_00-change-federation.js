const federationChangeTests = require('../lib/tests/change-federation');

federationChangeTests.execute('Federation change from p2sh to p2wsh', Runners.config.federations.thirdFederation);
