// Flat config for ESLint v9
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginImport from 'eslint-plugin-import';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.changeset/**',
      'eslint.config.mjs'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      import: pluginImport
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module'
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "Identifier[name='id']",
          message: "Use a descriptive identifier like user_id, blogpost_id, etc."
        }
      ],
      'import/no-default-export': 'error',
      'no-control-regex': 'off'
    }
  }
];
