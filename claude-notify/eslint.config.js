const js = require('@eslint/js');

module.exports = [
  { ignores: ['node_modules/**', '*.vsix'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['warn', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
    },
  },
];
