module.exports = {
  testEnvironment: 'node',
  testRegex: '.*\\.(e2e|integration)-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
};
