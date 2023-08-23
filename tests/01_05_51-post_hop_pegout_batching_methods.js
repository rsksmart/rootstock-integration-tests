const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

const peglib = require('peglib');
const rsk = peglib.rsk;
const CustomError = require('../lib/CustomError');

describe('Pegout Batching - Calling new bridge methods after hop400 activation', function () {

    before(() => {
        rskClient = rsk.getClient(Runners.hosts.federate.host);
    });

    it('should return 0 when calling getEstimatedFeesForNextPegOutEvent method', async () => {
        try {
            const estimatedFees = await rskClient.rsk.bridge.methods.getEstimatedFeesForNextPegOutEvent().call();
            expect(estimatedFees).to.be.equal("0");
        } catch (err) {
            throw new CustomError('getEstimatedFeesForNextPegOutEvent call failure', err);
        }
    })


    it('should return 0 when calling getNextPegoutCreationBlockNumber method', async () => {
        try {
            const blockNumber = await rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call();
            expect(blockNumber).to.be.equal("0");
        } catch (err) {
            throw new CustomError('getNextPegoutCreationBlockNumber call failure', err);
        }
    })

    it('should return 0 when calling getQueuedPegoutsCount method', async () => {
        try {
            const count = await rskClient.rsk.bridge.methods.getQueuedPegoutsCount().call();
            expect(count).to.be.equal("0");
        } catch (err) {
            throw new CustomError('getQueuedPegoutsCount call failure', err);
        }
    })

});
