module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__', '<rootDir>/modules'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'modules/**/*.js',
    'app.js',
    'metrics.js',
    'logger.js',
    '!node_modules/**',
    '!__tests__/**'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 80,
      statements: 80
    }
  },
  verbose: true,
  testTimeout: 10000,
  moduleFileExtensions: ['js', 'json'],
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.js'],
  transformIgnorePatterns: [
    'node_modules/(?!(discord\\.js|@discordjs|@types)/)'
  ]
};
