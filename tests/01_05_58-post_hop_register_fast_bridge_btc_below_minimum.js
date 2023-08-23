const {UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR} = require("../lib/flyover-pegin-response-codes");
const execute = require('../lib/tests/flyover-pegin').execute;

execute(
  'Executing registerFastBtcTransaction after hop - send funds below minimum',
  `should return UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR(${UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR}) when calling registerFastBtcTransaction method sending amount below minimum`,
  () => Runners.hosts.federate.host,
  false,
  UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR,
  0.02,
  false
);
