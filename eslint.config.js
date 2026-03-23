const js = require('@eslint/js');
const globals = require('globals');

const JS_FILES = ['**/*.js']; // only .js files (not .mjs/.cjs)

module.exports = [
    { ignores: ['node_modules/**', 'dist/**', 'coverage/**'] },

    {
        files: ['**/*.{js,cjs,mjs}'],
        ...js.configs.recommended,
    },

    // Your environment + language options
    {
        files: JS_FILES,
        languageOptions: {
            ecmaVersion: 2021,
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

    {
        files: ['**/*.cjs'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'commonjs',
            globals: {
                ...globals.node,
                ...globals.es2021,
            },
        },
    },

    {
        files: ['**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.es2021,
            },
        },
    },
];
