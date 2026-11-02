import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', '.next/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // `const { secret: _omit, ...rest } = obj` is the idiomatic way to
          // drop a key; the discarded binding is intentional.
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Scripts and tests are allowed to print to stdout.
    files: [
      'scripts/**/*.mjs',
      'scripts/**/*.ts',
      'tests/**/*.ts',
      'src/**/*.test.ts',
      'src/**/*.itest.ts',
    ],
    rules: { 'no-console': 'off' },
  },
  {
    // node:test's describe()/it() return promises that the runner owns; the
    // caller is not meant to await them, so no-floating-promises misfires here.
    files: ['src/**/*.itest.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
  {
    // Plain-JS/MJS files are outside the TS program, so type-aware rules
    // cannot run on them.
    files: ['scripts/**/*.mjs', '*.js', '*.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },
);
