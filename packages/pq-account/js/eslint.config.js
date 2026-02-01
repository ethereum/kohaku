import eslintJs from '@eslint/js';
import pluginImport from 'eslint-plugin-import';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import stylistic from '@stylistic/eslint-plugin';
import eslintPluginSonarjs from 'eslint-plugin-sonarjs';
import eslintPluginSimpleImportSort from 'eslint-plugin-simple-import-sort';
import eslintPluginUnicorn from 'eslint-plugin-unicorn';
import tseslint from 'typescript-eslint';
import eslintPluginUnusedImports from 'eslint-plugin-unused-imports';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '.changeset/**',
      'eslint.config.mjs',
      '**/*.js',
    ],
  },
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  eslintPluginPrettierRecommended,
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    plugins: {
      import: pluginImport,
      'simple-import-sort': eslintPluginSimpleImportSort,
      'unused-imports': eslintPluginUnusedImports,
      sonarjs: eslintPluginSonarjs,
      unicorn: eslintPluginUnicorn,
      '@stylistic': stylistic,
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            ":matches(VariableDeclarator, FunctionDeclaration, ArrowFunctionExpression, FunctionExpression) > Identifier[name='id']",
          message:
            'Use a descriptive identifier like user_id, blogpost_id, etc.',
        },
      ],
      'import/no-default-export': 'error',
      'no-control-regex': 'off',
      semi: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': [
        'warn',
        { allow: ['warn', 'error', 'log', 'debug', 'info'] },
      ],
      'linebreak-style': ['error', 'unix'],
      'object-curly-spacing': ['error', 'always'],
      'no-multiple-empty-lines': ['warn', { max: 2 }],
      'prefer-destructuring': 'warn',
      'prefer-arrow-callback': 'warn',
      'max-lines': ['error', 500],

      '@typescript-eslint/no-namespace': 'off',

      // Import rules
      'import/no-duplicates': 'error',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          varsIgnorePattern: '^_',
          args: 'after-used',
          argsIgnorePattern: '^_',
        },
      ],
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // TypeScript rules
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',

      // SonarJS rules for code quality
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 3 }],
      'sonarjs/no-identical-functions': 'error',

      // Unicorn rules for modern JS practices
      'unicorn/prefer-module': 'error',
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/no-array-for-each': 'off', // Allow forEach
      'unicorn/prevent-abbreviations': 'off', // Allow abbreviations

      // Padding lines for readability
      'padding-line-between-statements': [
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
    },
  },
  {
    files: ['**/vitest.config.ts', '**/vite.config.ts', '**/App.tsx'],
    plugins: {
      import: pluginImport,
    },
    rules: {
      'import/no-default-export': 'off',
    },
  },
];