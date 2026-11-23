/** @type {import('jest').Config} */
const transform = { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: false }] };

module.exports = {
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.spec.ts'],
      transform,
      setupFiles: ['<rootDir>/test/setup-unit-env.ts'],
    },
    {
      displayName: 'integration',
      testEnvironment: 'node',
      roots: ['<rootDir>/test'],
      testMatch: ['**/*.int-spec.ts'],
      transform,
      setupFiles: ['<rootDir>/test/setup-env.ts'],
      setupFilesAfterEnv: ['<rootDir>/test/setup-timeout.ts'],
      globalSetup: '<rootDir>/test/global-setup.ts',
    },
  ],
};
