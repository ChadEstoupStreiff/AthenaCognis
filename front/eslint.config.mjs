import eslint from '@eslint/js';
import angular from 'angular-eslint';
import jsdoc from 'eslint-plugin-jsdoc';
import tseslint from 'typescript-eslint';

const MAX_FUNCTION_LINES = 40;
const MAX_DEPTH = 3;
const MAX_COMPLEXITY = 10;

/** Rules shared by every TypeScript file (mirrors the repo's CLAUDE.md coding rules). */
const codeStyleRules = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/explicit-function-return-type': [
    'error',
    { allowExpressions: true, allowTypedFunctionExpressions: true },
  ],
  '@typescript-eslint/explicit-module-boundary-types': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
  '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
  '@typescript-eslint/no-magic-numbers': [
    'error',
    {
      ignore: [-1, 0, 1, 2],
      ignoreEnums: true,
      ignoreReadonlyClassProperties: true,
      ignoreNumericLiteralTypes: true,
      ignoreTypeIndexes: true,
      ignoreArrayIndexes: true,
      ignoreDefaultValues: true,
    },
  ],
  'max-lines-per-function': [
    'error',
    { max: MAX_FUNCTION_LINES, skipBlankLines: true, skipComments: true },
  ],
  'max-depth': ['error', MAX_DEPTH],
  complexity: ['error', MAX_COMPLEXITY],
  'no-console': 'error',
  eqeqeq: 'error',
  'prefer-const': 'error',
  'jsdoc/require-jsdoc': [
    'error',
    {
      checkConstructors: false,
      require: { FunctionDeclaration: true, MethodDefinition: true, ClassDeclaration: true },
    },
  ],
  'jsdoc/require-returns-type': 'off',
  'jsdoc/require-param-type': 'off',
  'jsdoc/require-throws-type': 'off',
  'jsdoc/require-yields-type': 'off',
  'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
};

/** Relaxations for test files. */
const testRules = {
  '@typescript-eslint/no-magic-numbers': 'off',
  'max-lines-per-function': 'off',
  'jsdoc/require-jsdoc': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/no-unsafe-member-access': 'off',
  '@typescript-eslint/no-unsafe-assignment': 'off',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.angular/**',
      '**/node_modules/**',
      '**/coverage/**',
      'eslint.config.mjs',
      'proxy.conf.mjs',
      'e2e/test-results/**',
      'e2e/playwright-report/**',
    ],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
      jsdoc.configs['flat/recommended-typescript'],
    ],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: codeStyleRules,
  },
  {
    files: ['src/**/*.ts'],
    extends: [...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'ac', style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'ac', style: 'camelCase' },
      ],
    },
  },
  {
    files: ['src/**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/label-has-associated-control': [
        'error',
        {
          controlComponents: [
            'p-colorpicker',
            'p-checkbox',
            'p-toggleswitch',
            'p-datepicker',
            'p-select',
            'p-multiselect',
            'p-inputnumber',
            'p-password',
            'p-textarea',
            'p-radiobutton',
            'p-slider',
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.spec.ts', 'e2e/**/*.ts'],
    rules: testRules,
  },
);
