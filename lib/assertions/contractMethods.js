const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

const assertContractCallReturnsWithCallback = async (methodCall, expectedCallback, options) => {
    const result = await methodCall.call(options);
    return await expectedCallback(result);
};

const assertContractCallReturns = async (methodCall, expected) => {
    return assertContractCallReturnsWithCallback(
        methodCall,
        (result) => expect(result).to.be.eq(expected)
    );
};

const assertContractCallFails = async (methodCall, options) => {
    await expect(methodCall.call(options)).to.be.rejected;
};

module.exports = {
    assertContractCallReturnsWithCallback,
    assertContractCallReturns,
    assertContractCallFails
};
