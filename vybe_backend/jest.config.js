module.exports = {
  testEnvironment: 'node',
  testTimeout: 60000,
  setupFiles: ['<rootDir>/tests/helpers/testEnv.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/helpers/setupTeardown.js'],
  testPathIgnorePatterns: ['/node_modules/', '/tests/helpers/'],
};
