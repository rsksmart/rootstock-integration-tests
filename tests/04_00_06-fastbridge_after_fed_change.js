const {UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR} = require("../lib/flyover-pegin-response-codes");
const execute = require('../lib/tests/flyover-pegin').execute;

execute(
  'Executing registerFastBtcTransaction after hop and federation changed',
  `should return UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR(${UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR}) when calling registerFastBtcTransaction method sending amount below minimum after fed changed`,
  () => Runners.hosts.federates[Runners.hosts.federates.length - 1].host,
  true,
  UNPROCESSABLE_TX_AMOUNT_SENT_BELOW_MINIMUM_ERROR,
  0.05,
  false
);
