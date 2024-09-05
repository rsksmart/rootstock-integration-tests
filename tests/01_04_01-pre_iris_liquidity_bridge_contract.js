const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));
const CustomError = require('../lib/CustomError');
const lbc = require('../lib/liquidity-bridge-contract');

let liquidityBridgeContract;

// Skipped due to 'running with all forks active' changes.

describe.skip('Call liquidity bridge contract before iris300', () => {

    it('should create the testing contract', async () => {
        try {
            liquidityBridgeContract = await lbc.getLiquidityBridgeContract();
            
            let isAlive = await liquidityBridgeContract.methods.areYouAlive().call();
            expect(isAlive).to.equal('yes i am');
        } catch (err) {
            throw new CustomError('Contract creation failure', err);
        }
    });

    it('fails when calling registerFastBridgeBtcTransaction', async () => {
        // Arrange
        let fedBtcAddress = '0x0101';
        let liquidityProviderRskAddress = '0x0000000000000000000000000000000000000001';
        let callContract = '0x0000000000000000000000000000000000000002';
        let callContractArguments = '0x0202'; 
        let penaltyFee = 1;
        let successFee = 2;
        let gasLimit = 3;
        let nonce = 0;
        let valueToTransfer = 10;

        let preHash = await liquidityBridgeContract.methods.hash(
            fedBtcAddress, 
            liquidityProviderRskAddress, 
            callContract, 
            callContractArguments, 
            penaltyFee, 
            successFee, 
            gasLimit, 
            nonce, 
            valueToTransfer
        ).call();
    
        let btcRawTransaction = '0x001001';
        let partialMerkleTree = '0x002001';
        let height = 100; 
        let userBtcRefundAddress = '0x0005';
        let liquidityProviderBtcAddress = '0x0006';

        let derivationHash = await liquidityBridgeContract.methods.getDerivationHash(
            preHash, 
            userBtcRefundAddress, 
            liquidityProviderBtcAddress
        ).call();
        
        let initialAmount = 90;
        await liquidityBridgeContract.methods.setDerivationHashBalance(derivationHash, initialAmount);

        // Act
        await expect(liquidityBridgeContract.methods.registerFastBridgeBtcTransaction(
            btcRawTransaction, 
            partialMerkleTree, 
            height,
            userBtcRefundAddress,
            liquidityProviderBtcAddress,
            preHash
        ).call()).to.be.rejected;
    });
});
