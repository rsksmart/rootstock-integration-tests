// For example, trying to run the 2wp.js test file again would require to delete the cache of the 2wp.js file in require.
delete require.cache[require.resolve('../lib/tests/2wp')];
require('../lib/tests/2wp');
