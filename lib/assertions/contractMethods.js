const chai = require('chai');
const expect = chai.expect;
chai.use(require('chai-as-promised'));

const assertContractCallReturnsWithCallback = async (
    contract,
    methodName,
    methodArgs,
    expectedCallback,
    options
) => {
    const args = options ? [...methodArgs, options] : methodArgs;
    const result = await contract[methodName].staticCall(...args);
    return await expectedCallback(result);
};

const assertContractCallReturns = async (contract, methodName, methodArgs, expected) => {
    // `result` may be a bigint for numeric return types; stringify both sides so a string
    // `expected` (the caller's usual convention) still compares correctly.
    return assertContractCallReturnsWithCallback(contract, methodName, methodArgs, (result) =>
        expect(result.toString()).to.be.eq(expected.toString())
    );
};

const assertContractCallFails = async (contract, methodName, methodArgs, options) => {
    const args = options ? [...methodArgs, options] : methodArgs;
    await expect(contract[methodName].staticCall(...args)).to.be.rejected;
};

module.exports = {
    assertContractCallReturnsWithCallback,
    assertContractCallReturns,
    assertContractCallFails,
};
