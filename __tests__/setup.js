/**
 * Jest setup file - configure mocks and test environment
 */

// Mock discord.js
jest.mock('discord.js', () => ({
  Client: jest.fn(() => ({
    once: jest.fn(),
    on: jest.fn(),
    login: jest.fn(),
    destroy: jest.fn(),
    isReady: jest.fn(() => true),
    user: {
      tag: 'TestBot#0000'
    },
    guilds: {
      cache: new Map()
    }
  })),
  GatewayIntentBits: {
    Guilds: 1,
    GuildMessages: 2
  },
  SlashCommandBuilder: jest.fn(() => ({
    setName: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addStringOption: jest.fn().mockReturnThis(),
    toJSON: jest.fn().mockReturnValue({})
  })),
  EmbedBuilder: jest.fn(() => ({
    setTitle: jest.fn().mockReturnThis(),
    setDescription: jest.fn().mockReturnThis(),
    addFields: jest.fn().mockReturnThis(),
    setImage: jest.fn().mockReturnThis(),
    setColor: jest.fn().mockReturnThis(),
    setThumbnail: jest.fn().mockReturnThis(),
    setAuthor: jest.fn().mockReturnThis(),
    setFooter: jest.fn().mockReturnThis(),
    setURL: jest.fn().mockReturnThis()
  }))
}));

// Mock axios
jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn()
}));

// Mock prom-client
jest.mock('prom-client', () => ({
  collectDefaultMetrics: jest.fn(),
  Counter: jest.fn(function(config) {
    this.inc = jest.fn();
    this.labels = jest.fn().mockReturnThis();
    return this;
  }),
  Histogram: jest.fn(function(config) {
    this.startTimer = jest.fn(() => jest.fn());
    this.labels = jest.fn().mockReturnThis();
    return this;
  }),
  Gauge: jest.fn(function(config) {
    this.set = jest.fn();
    this.labels = jest.fn().mockReturnThis();
    return this;
  }),
  register: {
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
    metrics: jest.fn().mockResolvedValue('# HELP test\ntest{} 0')
  }
}));

// Mock logger
jest.mock('../logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

// Set test environment variables
process.env.DISCORD_TOKEN = 'test-token-12345';
process.env.METRICS_PORT = '9999';
process.env.NODE_ENV = 'test';

// Suppress console output during tests (optional)
global.console = {
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};
