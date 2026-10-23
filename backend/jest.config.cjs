process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-32-characters-long-1234567890';

module.exports = {
  testEnvironment: 'node',
  testRegex: '.*\\.(e2e|integration)-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  setupFiles: ['<rootDir>/test/setup.ts'],
};
