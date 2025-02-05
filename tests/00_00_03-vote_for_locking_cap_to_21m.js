const rskUtils = require('../lib/rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');
const { getBridge } = require('../lib/bridge-provider');
const { btcToWeis, btcToSatoshis } = require('@rsksmart/btc-eth-unit-converter');
const { expect } = require('chai');

const lockingCapAuthorizerPrivateKey = 'da6a5451bfd74829307ec6d4a8c55174d4859169f162a8ed8fcba8f7636e77cc';

describe('Vote for locking cap to the max 21 million btc', function() {

    let rskTxHelpers;
  
    before(async () => {
        rskTxHelpers = getRskTransactionHelpers();
    });

    it('should increase locking cap to the max 21 million btc', async () => {

        const rskTxHelper = rskTxHelpers[0];

        const authAddress = await rskTxHelper.getClient().eth.personal.importRawKey(lockingCapAuthorizerPrivateKey, '');
        await rskUtils.sendFromCow(rskTxHelper, authAddress, btcToWeis(1));

        const bridge = await getBridge(rskTxHelper.getClient());

        const MAX_BTC = 21_000_000;

        const targetLockingCapInSatoshis = Number(btcToSatoshis(MAX_BTC));

        let currentLockingCapValueInSatoshis = Number(await bridge.methods.getLockingCap().call());

        let nextIncrement = 0;

        while(nextIncrement < targetLockingCapInSatoshis) {
            
            nextIncrement = currentLockingCapValueInSatoshis * 2;

            // Ensuring that the next increment is not greater than the target locking cap.
            nextIncrement = Math.min(nextIncrement, targetLockingCapInSatoshis);

            const increaseLockingCapMethod = bridge.methods.increaseLockingCap(nextIncrement);

            await rskUtils.sendTransaction(rskTxHelper, increaseLockingCapMethod, authAddress);

            currentLockingCapValueInSatoshis = Number(await bridge.methods.getLockingCap().call());

            // Ensuring that the locking cap is being increased on every iteration.
            expect(currentLockingCapValueInSatoshis).to.be.equal(nextIncrement, 'The new locking cap value should be equal to the set value');

        }

        const finalLockingCapValueInSatoshis = Number(await bridge.methods.getLockingCap().call());

        expect(finalLockingCapValueInSatoshis).to.be.equal(targetLockingCapInSatoshis);

    });
});
