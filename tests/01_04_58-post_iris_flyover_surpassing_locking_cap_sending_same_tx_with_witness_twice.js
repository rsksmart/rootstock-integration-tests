const {UNPROCESSABLE_TX_ALREADY_PROCESSED_ERROR, REFUNDED_USER_ERROR} = require("../lib/flyover-pegin-response-codes");
const executeSameTxTwice = require('../lib/tests/flyover-pegin').executeSameTxTwice;

executeSameTxTwice(
  'Executing registerFastBtcTransaction post hop - surpassing locking cap sending same tx with witness twice',
  `The first tx should fail due to surpassing the locking cap, and the second tx should fail due to hash already been used`,
  () => Runners.hosts.federate.host,
  true,
  REFUNDED_USER_ERROR,
  UNPROCESSABLE_TX_ALREADY_PROCESSED_ERROR,
  2500
);
