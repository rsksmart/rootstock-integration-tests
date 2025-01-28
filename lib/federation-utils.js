const { KEY_TYPE_BTC, KEY_TYPE_RSK, KEY_TYPE_MST } = require('./constants/federation-constants');

var comparePublicKeys = (publicKeyA, publicKeyB) => {
  if (publicKeyA < publicKeyB) {
    return -1;
  }

  if (publicKeyA > publicKeyB) {
    return 1;
  }

  return 0;
};

var compareFederateKeys = (publicKeysA, publicKeysB) => {
  var comparison = comparePublicKeys(publicKeysA[KEY_TYPE_BTC], publicKeysB[KEY_TYPE_BTC]);
  if (comparison === 0) {
    comparison = comparePublicKeys(publicKeysA[KEY_TYPE_RSK], publicKeysB[KEY_TYPE_RSK]);
    if (comparison === 0) {
      comparison = comparePublicKeys(publicKeysA[KEY_TYPE_MST], publicKeysB[KEY_TYPE_MST]);
    }
  }
  return comparison;
};

const getActiveFederationPublicKeys = async (bridge) => {

  const initialFederationKeys = [];

  const initialFederationSize = Number(await bridge.methods.getFederationSize().call());

  for(let i = 0; i < initialFederationSize; i++) {

      const federatorBtcPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_BTC).call();
      const federatorRskPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_RSK).call();
      const federatorMstPublicKey = await bridge.methods.getFederatorPublicKeyOfType(i, KEY_TYPE_MST).call();

      initialFederationKeys.push({
          [KEY_TYPE_BTC]: federatorBtcPublicKey,
          [KEY_TYPE_RSK]: federatorRskPublicKey,
          [KEY_TYPE_MST]: federatorMstPublicKey
      });
      
  }

  return initialFederationKeys;

};

const getProposedFederationPublicKeys = async (bridge) => {

  const proposedFederationKeys = [];

  const proposedFederationSize = Number(await bridge.methods.getProposedFederationSize().call());

  for(let i = 0; i < proposedFederationSize; i++) {

      const federatorBtcPublicKey = await bridge.methods.getProposedFederatorPublicKeyOfType(i, KEY_TYPE_BTC).call();
      const federatorRskPublicKey = await bridge.methods.getProposedFederatorPublicKeyOfType(i, KEY_TYPE_RSK).call();
      const federatorMstPublicKey = await bridge.methods.getProposedFederatorPublicKeyOfType(i, KEY_TYPE_MST).call();

      proposedFederationKeys.push({
          [KEY_TYPE_BTC]: federatorBtcPublicKey,
          [KEY_TYPE_RSK]: federatorRskPublicKey,
          [KEY_TYPE_MST]: federatorMstPublicKey
      });

  }

  return proposedFederationKeys;

};

const getProposedFederationInfo = async (bridge) => {

  const proposedFederationInfoResponses = await Promise.all([
      bridge.methods.getProposedFederationSize().call(),
      bridge.methods.getProposedFederationAddress().call(),
      bridge.methods.getProposedFederationCreationBlockNumber().call(),
      bridge.methods.getProposedFederationCreationTime().call()
  ]);

  const proposedFederationSize = Number(proposedFederationInfoResponses[0]);
  const proposedFederationAddress = proposedFederationInfoResponses[1];
  const proposedFederationCreationBlockNumber = Number(proposedFederationInfoResponses[2]);
  const proposedFederationCreationTime = Number(proposedFederationInfoResponses[3]);

  return {
      proposedFederationSize,
      proposedFederationAddress,
      proposedFederationCreationBlockNumber,
      proposedFederationCreationTime
  };

};

module.exports = {
  comparePublicKeys,
  compareFederateKeys,
  getProposedFederationPublicKeys,
  getProposedFederationInfo,
  getActiveFederationPublicKeys,
};
