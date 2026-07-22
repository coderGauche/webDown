import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // TypeScript 7 is not supported by the current typescript-eslint parser.
    // TypeScript sources are covered by `pnpm typecheck` until parser support lands.
    ignores: ['.output/**', '.wxt/**', 'node_modules/**', 'coverage/**', '**/*.ts', '**/*.tsx'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
];
