const { getRskTransactionHelper } = require('../lib/rsk-tx-helper-provider');

describe('RSK Federation change', function() {
    
    let rskTxHelper;
  
    before(async () => {
        rskTxHelper = getRskTransactionHelper();
    });

    it('should add a new federation node', async () => {

        const latestBlock = await rskTxHelper.getBlock('latest');

        await Runners.startAdditionalFederateNodes(latestBlock);

    });

});
