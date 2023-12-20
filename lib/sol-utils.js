let solc = require('solc');
const { wait } = require('./utils');
const { mineAndSync } = require('./rsk-utils');
const { getRskTransactionHelpers } = require('../lib/rsk-tx-helper-provider');

const promisefy = function(f, args) {
  args = args || [];
  return new Promise(function(resolve, reject) {
    const callback = function(error, result) {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    }
    const finalArgs = args.concat(callback);
    f.apply(null, finalArgs);
  });
};


const compileAndDeploy = async(compilerVersion, source, name, constructorArguments, rskTxHelper, options) => {
  const client = rskTxHelper.getClient();
  // Default options
  options = Object.assign({
    mine: async () => {
      return await mineAndSync(getRskTransactionHelpers());
    },
    gas: 'estimate',
  }, options);

  // Get the corresponding version of the solidity compiler
  try {
    solc = await promisefy(solc.loadRemoteVersion, [compilerVersion]);
  } catch (err) {
      Promise.reject(err);
  }

  const input = {
    language: 'Solidity',
    sources: {
      contract: {
        content: source
      }
    },
    settings: {
      outputSelection: {
        '*': {
          '*': ['*']
        }
      }
    }
  };
  
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (!output.contracts || Object.keys(output.contracts).length === 0) {
    return Promise.reject(output.errors);
  }

  const compiledContract = output.contracts.contract[`${name}`];
  if (compiledContract == null) {
    return Promise.reject(`Contract '${name}' not found`);
  }

  const bytecode = '0x' + compiledContract.evm.bytecode.object;
  const creationContract = new client.eth.Contract(compiledContract.abi);
  const creationTx = creationContract.deploy({ data: bytecode, arguments: constructorArguments });
  let estimateGas = Promise.resolve(options.gas);

  if (options.gas === 'estimate') {
    estimateGas = creationTx.estimateGas();
  }

  const gasNeeded = await estimateGas;

  const contractPromise = creationTx.send({
    from: options.from,
    gas: gasNeeded,
    gasPrice: options.gasPrice
  });

  await wait(1000);

  await options.mine();

  const contract = await contractPromise;

  return contract;

};

module.exports = {
  compileAndDeploy
};
