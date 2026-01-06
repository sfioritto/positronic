/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts', '.tsx', '.jsx'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@positronic/core$': '<rootDir>/packages/core/src',
    '^@positronic/(.*)$': '<rootDir>/packages/$1/src',
    '^robot3$': '<rootDir>/node_modules/robot3/dist/machine.js',
  },
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(ink|ansi-styles|kleur|strip-ansi|robot3)/)',
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
