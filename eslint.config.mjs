// Flat config for ESLint v9
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginImport from 'eslint-plugin-import';
import stylistic from '@stylistic/eslint-plugin';

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
      import: pluginImport,
      '@stylistic': stylistic,
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
      'no-control-regex': 'off',
      // Disable triple-slash-reference rule globally to allow triple slash references
      '@typescript-eslint/triple-slash-reference': 'off',
      '@stylistic/padding-line-between-statements': [
        'error',
        {
          blankLine: 'always',
          prev: '*',
          next: ['return', 'if', 'switch', 'try', 'for'],
        },
        {
          blankLine: 'always',
          prev: ['if', 'switch', 'try', 'const', 'let'],
          next: '*',
        },
        {
          blankLine: 'any',
          prev: ['const', 'let'],
          next: ['const', 'let'],
        },
      ],
    }
  },
  {
    ignores: [
      '**/railgun/lib/**',
      '**/railgun/logic/**',
      '**/demo/**',
      '**/tests/**',
      '**/docs/**',
    ],
    rules: {
      'max-lines': ['error', 200],
    }
  }
];
