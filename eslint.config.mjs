import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  {
    ignores: ['coverage/', 'logs/'],
  },
  js.configs.recommended,
  {
    rules: {
      // Catch params are routinely ignored on purpose in this codebase
      // (e.g. `catch (_)` around URL parsing); don't flag them.
      // Underscore-prefixed args mark deliberate non-use.
      'no-unused-vars': [
        'error',
        {
          caughtErrors: 'none',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // The config itself and any .mjs tooling files are ESM, not CommonJS.
    files: ['**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['__tests__/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  // Must stay last: it disables stylistic rules that would conflict with Prettier.
  eslintConfigPrettier,
];
