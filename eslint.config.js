const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = [
    {
        ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
    },

    {
        files: ['**/*.{js,cjs,mjs}'],
        ...js.configs.recommended,
    },

    {
        files: ['**/*.{js,cjs}'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2021,
                ...globals.mocha,
            },
        },
        rules: {
            'no-console': 'warn',
        },
    },

    // Prettier config to disable conflicting rules (keep last)
    prettierConfig,
];
