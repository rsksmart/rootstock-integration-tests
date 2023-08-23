const {REFUNDED_USER_ERROR} = require("../lib/flyover-pegin-response-codes");
const execute = require('../lib/tests/flyover-pegin').execute;

execute(
  'Executing registerFastBtcTransaction after iris - with release',
  'should return funds when calling registerFastBtcTransaction method surpassing locking cap',
  () => Runners.hosts.federate.host,
  false,
  REFUNDED_USER_ERROR,
  2500,
  false
);
