const extendWeb3WithRskModule = (web3) => {
    web3.extend({
      property: 'rsk',
      methods: [{
          name: 'getStorageBytesAt',
          call: 'rsk_getStorageBytesAt',
          params: 3,
          inputFormatter: [web3.extend.formatters.inputAddressFormatter, web3.extend.formatters.inputDefaultBlockNumberFormatter, web3.extend.formatters.inputDefaultBlockNumberFormatter]
      }]
    });
};

module.exports = {
    extendWeb3WithRskModule,
};
