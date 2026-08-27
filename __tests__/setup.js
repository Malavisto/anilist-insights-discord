// Global test setup
process.env.NODE_ENV = 'test';

// Mock Discord.js client warnings
const originalWarn = console.warn;
console.warn = (...args) => {
  if (
    args[0]?.includes?.('DeprecationWarning') ||
    args[0]?.includes?.('ExperimentalWarning')
  ) {
    return;
  }
  originalWarn(...args);
};

// Set timeout for all tests
jest.setTimeout(10000);
