module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__', '<rootDir>/modules'],
  testMatch: ['**/__tests__/**/*.test.js'],
  collectCoverageFrom: [
    'modules/**/*.js',
    'app.js',
    '!node_modules/**',
    '!__tests__/**'
  ],
  coverageThreshold: {
    global: {
      branches: 60,
      functions: 60,
      lines: 70,
      statements: 70
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
