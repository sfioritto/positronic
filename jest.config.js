/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx', '.jsx'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@positronic/core$': '<rootDir>/packages/core/src',
    '^@positronic/(.*)$': '<rootDir>/packages/$1/src',
  },
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(ink|ansi-styles|kleur|strip-ansi)/)',
  ],
  testPathIgnorePatterns: [
    '.test-cache/',
    '/node_modules/',
    '/dist/',
    '<rootDir>/packages/cloudflare/test-project/',
    '<rootDir>/packages/template-new-project/template/',
  ],
  modulePathIgnorePatterns: [
    '<rootDir>/packages/template-new-project/template/',
  ],
};

export default config;
