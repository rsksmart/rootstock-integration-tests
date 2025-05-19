const { getBridgeStorageIndexFromKey } = require('../utils');

const KEY_TYPE_BTC = 'btc';
const KEY_TYPE_RSK = 'rsk';
const KEY_TYPE_MST = 'mst';

const KEY_TYPES = [KEY_TYPE_BTC, KEY_TYPE_RSK, KEY_TYPE_MST];

const ERP_PUBKEYS = [
  '029cecea902067992d52c38b28bf0bb2345bda9b21eca76b16a17c477a64e43301',
  '03284178e5fbcc63c54c3b38e3ef88adf2da6c526313650041b0ef955763634ebd',
  '03776b1fd8f86da3c1db3d69699e8250a15877d286734ea9a6da8e9d8ad25d16c1',
  '03ab0e2cd7ed158687fc13b88019990860cdb72b1f5777b58513312550ea1584bc',
  '03b9fc46657cf72a1afa007ecf431de1cd27ff5cc8829fa625b66ca47b967e6b24'
];

const ERP_CSV_VALUE = 500;

const MAX_INPUTS_PER_MIGRATION_TRANSACTION = 10;

const REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS = [
  'c14991a187e185ca1442e75eb8f60a6a5efd4ca57ce31e50d6e841d9381e996b',
  '488cdd0c11d602598225fe96c4b85c2afbec3f1d938cd88f4655831cb6ff454b',
  '72255947e1aff21d3fc9c077c6a70912aede3674913d5c76b4128c1ec5692499',
  'fb69358d4760c80977497073e80281e47fa3e6ccf7371a215506ec295c1d8c69',
  '857ec435ef0160993dc5f1e70f19f30b1b0249f061cc52294fd266cb093df173',
];

const REGTEST_FEDERATION_CHANGE_ADDRESSES = [
  '5252403bca6ac3c104abdd320a736fa38282045d',
  '0d8c44bd578a4e7148d1758b3332b529e93e48c1',
  '566bca18df14ed75efcc1a8a4f3947e81132dbbc',
  '2e7c9159614ddc0185e335d3343e92700c3e5a2d',
  'f0652637df184eca87e6bde29893825721dfb79f',
];

const GENESIS_FEDERATION_ADDRESS = '2N5muMepJizJE1gR7FbHJU6CD18V3BpNF9p';
const GENESIS_FEDERATION_REDEEM_SCRIPT = '0x522102cd53fc53a07f211641a677d250f6de99caf620e8e77071e811a28b3bcddf0be1210362634ab57dae9cb373a5d536e66a8c4f67468bbcfb063809bab643072d78a1242103c5946b3fbae03a654237da863c9ed534e0878657175b132b8ca630f245df04db53ae';

const FEDERATION_ACTIVATION_AGE = 150;
const FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_BEGIN = 15;
const FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END = 150;
const VALIDATION_PERIOD_DURATION_IN_BLOCKS = 125;

const svpFundTxHashUnsignedStorageIndex = getBridgeStorageIndexFromKey('svpFundTxHashUnsigned');
const svpFundTxSignedStorageIndex = getBridgeStorageIndexFromKey('svpFundTxSigned');
const svpSpendTxHashUnsignedStorageIndex = getBridgeStorageIndexFromKey('svpSpendTxHashUnsigned');
const svpSpendTxWaitingForSignaturesStorageIndex = getBridgeStorageIndexFromKey('svpSpendTxWaitingForSignatures');

const oldFederationBtcUTXOSStorageIndex = getBridgeStorageIndexFromKey('oldFederationBtcUTXOs');
const newFederationBtcUTXOSStorageIndex = getBridgeStorageIndexFromKey('newFederationBtcUTXOs');

const FEDERATION_EVENTS = {
  COMMIT_FEDERATION_FAILED: {
    name: 'commit_federation_failed'
  },
};

module.exports = {
    KEY_TYPE_BTC,
    KEY_TYPE_RSK,
    KEY_TYPE_MST,
    KEY_TYPES,
    ERP_PUBKEYS,
    ERP_CSV_VALUE,
    MAX_INPUTS_PER_MIGRATION_TRANSACTION,
    REGTEST_FEDERATION_CHANGE_PRIVATE_KEYS,
    REGTEST_FEDERATION_CHANGE_ADDRESSES,
    GENESIS_FEDERATION_ADDRESS, 
    GENESIS_FEDERATION_REDEEM_SCRIPT,
    FEDERATION_ACTIVATION_AGE,
    FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_BEGIN,
    FUNDS_MIGRATION_AGE_SINCE_ACTIVATION_END,
    VALIDATION_PERIOD_DURATION_IN_BLOCKS,
    svpFundTxHashUnsignedStorageIndex,
    svpFundTxSignedStorageIndex,
    svpSpendTxHashUnsignedStorageIndex,
    svpSpendTxWaitingForSignaturesStorageIndex,
    oldFederationBtcUTXOSStorageIndex,
    newFederationBtcUTXOSStorageIndex,
    FEDERATION_EVENTS,
};
