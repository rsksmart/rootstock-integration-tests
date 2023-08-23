const {UNPROCESSABLE_TX_ALREADY_PROCESSED_ERROR} = require("../lib/flyover-pegin-response-codes");
const executeSameTxTwice = require('../lib/tests/flyover-pegin').executeSameTxTwice;

executeSameTxTwice(
  'Executing registerFastBtcTransaction post hop - sending same tx without witness twice',
  `should execute first tx successfully and fail executing second tx due to hash already used when calling registerFastBtcTransaction sending same tx twice`,
  () => Runners.hosts.federate.host,
  false,
  0.04,
  UNPROCESSABLE_TX_ALREADY_PROCESSED_ERROR,
  0.04
);
