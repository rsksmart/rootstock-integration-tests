const { wait } = require('./utils');

const isRunningHsms = () => {
    const hsmsRunning = Runners.fedRunners.some(fedRunner => fedRunner.hsm);
    console.log('hsmsRunning: ', hsmsRunning);
    return hsmsRunning;
};

const getHsmBestBlockNumber = async (rskTxHelper, hsm) => {
    const hsmBlockchainState = await hsm.getBlockchainState();
    const bestBlockHash = hsmBlockchainState.best_block;
    const bestBlock = await rskTxHelper.getBlock(`0x${bestBlockHash}`);
    console.log(`HSM ${hsm.id} best block number and hash: `, bestBlock.number, bestBlockHash);
    return bestBlock.number;
};

const waitForHsmsToBeSynchedToThisBlock = async (rskTxHelper, blockNumber, maxAttempts = 12) => {

    const hsms = Runners.fedRunners.filter(fedRunner => fedRunner.hsm).map(fedRunner => fedRunner.hsm);

    let allHsmsAreSyncedToExpectedBlock = false;
    let attempts = 0;

    let previousHsmsBestBlockNumbers = [];

    while(!allHsmsAreSyncedToExpectedBlock) {

        if(attempts >= maxAttempts) {
            // Sometimes there's just one hsm that is not synching, but others are synching and can sign, so we can continue.
            console.warn(`hsms not fully synched after ${maxAttempts} attempts.`);
            return {
                syncStatus: 'out_of_retries',
                success: false,
            };
        }

        try {
            const hsmsBestBlockNumbers = await Promise.all(hsms.map(hsm => getHsmBestBlockNumber(rskTxHelper, hsm)));

            allHsmsAreSyncedToExpectedBlock = hsmsBestBlockNumbers.every(hsmBestBlockNumber => hsmBestBlockNumber >= blockNumber);

            if(allHsmsAreSyncedToExpectedBlock) {
                console.log('hsms synced: ', hsmsBestBlockNumbers);
                return {
                    syncStatus: 'synched',
                    success: true,
                };
            }

            const isSynching = !previousHsmsBestBlockNumbers.every((blockNumber, index) => hsmsBestBlockNumbers[index] === blockNumber);

            // Only count the attempts if the hsms are not long synching, whether they are already synched or one of them is stuck and not synching.
            if(!isSynching) {
                attempts++;
            }

            previousHsmsBestBlockNumbers = hsmsBestBlockNumbers;
            
        } catch(e) {
            // This error happens randomly sometimes, but it doesn't mean the hsms are not working, it just didn't respond in time.
            console.error('Error while waiting for HSMs to be synched: ', e.message);
        } finally {
            await wait(4000);
        }

    }

};

const HSM_DIFFICULTY_TARGET = 3;

module.exports = {
    waitForHsmsToBeSynchedToThisBlock,
    HSM_DIFFICULTY_TARGET,
    isRunningHsms,
    getHsmBestBlockNumber,
};
