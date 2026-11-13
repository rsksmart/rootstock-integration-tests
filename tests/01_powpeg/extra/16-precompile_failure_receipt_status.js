const precompileFailureTests = require('../../../lib/tests/precompile_failure_receipt_status');

precompileFailureTests.execute(
    '@regression @bridge-methods @precompiled Failing direct call to a precompiled contract'
);
