const chai = require('chai');
chai.use(require('chai-as-promised'));
const expect = chai.expect;

const peglib = require('peglib');
const rsk = peglib.rsk;
const CustomError = require('../lib/CustomError');

// Skipped due to 'running with all forks active' changes.

describe.skip('Pegout Batching - Calling new bridge methods before hop400 activation', function () {

    before(() => {
        rskClient = rsk.getClient(Runners.hosts.federate.host);
    });

    it('should reject when calling getEstimatedFeesForNextPegOutEvent method', async () => {
        try {
            await expect(rskClient.rsk.bridge.methods.getEstimatedFeesForNextPegOutEvent().call()).to.be.rejected;
        } catch (err) {
            throw new CustomError('getEstimatedFeesForNextPegOutEvent call failure', err);
        }
    })


    it('should reject when calling getNextPegoutCreationBlockNumber method', async () => {
        try {
            await expect(rskClient.rsk.bridge.methods.getNextPegoutCreationBlockNumber().call()).to.be.rejected;
        } catch (err) {
            throw new CustomError('getNextPegoutCreationBlockNumber call failure', err);
        }
    })

    it('should reject when calling getQueuedPegoutsCount method', async () => {
        try {
            await expect(rskClient.rsk.bridge.methods.getQueuedPegoutsCount().call()).to.be.rejected;
        } catch (err) {
            throw new CustomError('getQueuedPegoutsCount call failure', err);
        }
    })

});
