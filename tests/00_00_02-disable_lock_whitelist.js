const { disableWhitelisting } = require('../lib/2wp-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBtcClient } = require('../lib/btc-client-provider');

describe('Disable lock whitelisting', function() {

  let rskTxHelper;
  let btcTxHelper;

  before(async () => {

    const rskTxHelpers = getRskTransactionHelpers();
    rskTxHelper = rskTxHelpers[0];
    btcTxHelper = getBtcClient();

  });

  it('should disable lock whitelist', async () => {
    await disableWhitelisting(rskTxHelper, btcTxHelper);
  });

});
