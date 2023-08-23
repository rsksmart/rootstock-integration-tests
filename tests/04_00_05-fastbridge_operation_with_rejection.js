const {REFUNDED_USER_ERROR} = require("../lib/flyover-pegin-response-codes");
const execute = require('../lib/tests/flyover-pegin').execute;

execute(
  'Executing registerFastBtcTransaction after fed change - with release',
  'should return funds when calling registerFastBtcTransaction method surpassing locking cap',
  () => Runners.hosts.federates[Runners.hosts.federates.length-1].host,
  true,
  REFUNDED_USER_ERROR,
  2500,
  false
);
