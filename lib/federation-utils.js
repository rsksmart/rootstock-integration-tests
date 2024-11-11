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

module.exports = {
  comparePublicKeys,
  compareFederateKeys,
};
