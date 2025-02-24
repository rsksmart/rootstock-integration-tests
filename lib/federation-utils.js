const { KEY_TYPE_BTC, KEY_TYPE_RSK, KEY_TYPE_MST } = require('./constants/federation-constants');
const { ethToWeis } = require('@rsksmart/btc-eth-unit-converter');
const rskUtils = require('./rsk-utils');
const federateStarter = require('./federate-starter');

const comparePublicKeys = (publicKeyA, publicKeyB) => {
  if (publicKeyA < publicKeyB) {
    return -1;
  }

  if (publicKeyA > publicKeyB) {
    return 1;
  }

  return 0;
};

const compareFederateKeys = (publicKeysA, publicKeysB) => {
  let comparison = comparePublicKeys(publicKeysA[KEY_TYPE_BTC], publicKeysB[KEY_TYPE_BTC]);
  if (comparison === 0) {
    comparison = comparePublicKeys(publicKeysA[KEY_TYPE_RSK], publicKeysB[KEY_TYPE_RSK]);
    if (comparison === 0) {
      comparison = comparePublicKeys(publicKeysA[KEY_TYPE_MST], publicKeysB[KEY_TYPE_MST]);
    }
  }
  return comparison;
};

const getNewFederationPublicKeysFromNewFederationConfig = (newFederationConfig) => {
  const newFederationPublicKeys = newFederationConfig.members.map(member => member.publicKeys);
  newFederationPublicKeys.sort((keyA, keyB) => keyA.btc.localeCompare(keyB.btc));
  return newFederationPublicKeys;
};

const stopPreviousFederators = async (newFederationConfig) => {

  // TODO: right now there is only the genesis federation and a second federation. So the previous is the genesis federation.
  // When more are added, we need to change this logic to dynamically select the previous federation.
  // I tried with a `switch` statement ready for future changes but sonar complains about it.
  const previousFederationId = 'genesis-federation';

  Runners.fedRunners.forEach((fedRunner) => {
      if(fedRunner.options.federationId === previousFederationId) {
          fedRunner.stop();
      }
  });

  Runners.fedRunners = Runners.fedRunners.filter(fedRunner => fedRunner.options.federationId !== previousFederationId);
  Runners.hosts.federates = Runners.hosts.federates.filter(fedHostInfo => fedHostInfo.federationId !== previousFederationId);
  Runners.hosts.federate = Runners.hosts.federates[0];     

};

const startNewFederationNodes = async (newFederationConfig) => {
  for(let i = 0; i < newFederationConfig.length; i++) {
      const fedConfig = newFederationConfig[i];
      await federateStarter.startFederate(i + 1, fedConfig);
  }
};

const fundNewFederators = async (rskTxHelper, newFederationConfig) => {
  for(const newFederatorConfig of newFederationConfig) {
      const newFederatorRskCompressedPublicKey = newFederatorConfig.publicKeys.rsk;
      const newFederatorRskAddress = rskUtils.getAddressFromUncompressedPublicKey(rskUtils.uncompressPublicKey(newFederatorRskCompressedPublicKey));
      await rskUtils.sendFromCow(rskTxHelper, newFederatorRskAddress, ethToWeis(0.1));
  }
};

module.exports = {
  comparePublicKeys,
  compareFederateKeys,
  getNewFederationPublicKeysFromNewFederationConfig,
  stopPreviousFederators,
  startNewFederationNodes,
  fundNewFederators,
};
