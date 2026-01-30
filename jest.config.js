// Shared configuration for all projects
const sharedConfig = {
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
  // With --experimental-vm-modules, Node.js handles ESM/CJS interop natively for
  // node_modules. We only transform packages that need it (ESM-only packages that
  // Jest can't load directly). Notably, signal-exit is NOT included here - letting
  // Node load it natively avoids conflicts between v3 (CJS) and v4 (ESM) versions.
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

/** @type {import('jest').Config} */
const config = {
  projects: [
    {
      // CLI package tests - with nock network safety net
      // Excludes server.test.ts which tests the server command itself
      displayName: 'cli',
      ...sharedConfig,
      testMatch: ['<rootDir>/packages/cli/**/*.test.ts'],
      testPathIgnorePatterns: [
        ...sharedConfig.testPathIgnorePatterns,
        '<rootDir>/packages/cli/tests/server.test.ts',
      ],
      setupFilesAfterEnv: ['<rootDir>/packages/cli/tests/jest.setup.ts'],
    },
    {
      // CLI server tests - no nock setup (tests the server command itself)
      displayName: 'cli-server',
      ...sharedConfig,
      testMatch: ['<rootDir>/packages/cli/tests/server.test.ts'],
    },
    {
      // All other tests
      displayName: 'other',
      ...sharedConfig,
      testMatch: ['<rootDir>/packages/**/*.test.ts'],
      testPathIgnorePatterns: [
        ...sharedConfig.testPathIgnorePatterns,
        '<rootDir>/packages/cli/',
      ],
    },
  ],
};

export default config;
