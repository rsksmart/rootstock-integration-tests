const federationChangeTests = require('../lib/tests/change-federation');

federationChangeTests.execute('Federation change from p2wsh to p2wsh', Runners.config.federations.fourthFederation, true);
