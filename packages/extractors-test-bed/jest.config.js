/** @type {import('jest').Config} */
export default {
  displayName: 'extraction-test-bed',
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  testMatch: ['**/tests/jest/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',

  // JUnit XML reporter configuration
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: './junit-output',
        outputName: 'junit.xml',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true,
      },
    ],
  ],
};
