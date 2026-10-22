import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist', 'dist-site', 'playwright-report', 'test-results']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    // The matching engine is pure: it imports only its own files and config, and
    // never touches the network or the DOM. tests/engine/boundaries.test.ts checks the same.
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!\\./[\\w-]+$|\\.\\./config$)',
              message: 'src/engine may import only its own files and src/config.ts.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...[
          'fetch',
          'XMLHttpRequest',
          'WebSocket',
          'EventSource',
          'document',
          'window',
          'navigator',
          'location',
          'localStorage',
          'sessionStorage',
          'indexedDB',
          'globalThis',
          'self',
        ].map((name) => ({ name, message: 'src/engine must not use the network or the DOM.' })),
      ],
    },
  },
  {
    files: ['*.{js,ts}', 'e2e/**/*.ts', 'site/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
]);
