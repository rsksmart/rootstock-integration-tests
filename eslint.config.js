const powpegConfig = require('eslint-config-powpeg');
const prettierConfig = require('eslint-config-prettier/flat');


module.exports = [
    ...powpegConfig,
    prettierConfig, // Prettier config to disable conflicting rules (keep last)
];
