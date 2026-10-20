import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Starts with rules whose findings are almost always real defects (unhandled
 * promises, promises passed where a callback is expected, dead code). The wider
 * `recommendedTypeChecked` set (mainly the no-unsafe-* family) is the next step;
 * see docs/backend-refactoring-roadmap.md.
 */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  // Development scripts read loosely typed API responses.
  { files: ['src/scripts/**'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
);
