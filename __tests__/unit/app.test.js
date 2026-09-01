// Env vars must be set before app.js is required - it reads both at module load
process.env.DISCORD_TOKEN = 'test-token';
process.env.METRICS_PORT = '9911';

const { AniListDiscordBot } = require('../../app');
const { Client, GatewayIntentBits } = require('discord.js');
const logger = require('../../logger');
const { createMockInteraction } = require('../helpers/mockInteraction');

jest.mock('../../logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../metrics', () => ({
  trackCommand: jest.fn(() => jest.fn()),
  trackApiRequest: jest.fn(),
  trackCacheHit: jest.fn(),
  trackError: jest.fn(),
  getMetrics: jest.fn()
}));

// Service instances the bot should hold
const mockRandom = { handleRandomAnimeCommand: jest.fn() };
const mockStats = { handleAnimeStatsCommand: jest.fn() };
const mockRecommendation = { handleAnimeRecommendCommand: jest.fn() };
const mockCover = { handleAnimeCoverCommand: jest.fn() };

// Real command definitions (real SlashCommandBuilders) keep this test honest
// about the register/dispatch sync invariant; only the constructor is faked.
const mockRealRandom = jest.requireActual('../../modules/RandomAnimeService');
const mockRealStats = jest.requireActual('../../modules/AnimeStatsService');
const mockRealRecommendation = jest.requireActual('../../modules/animeRecommendation');
const mockRealCover = jest.requireActual('../../modules/AnimeCoverService');

jest.mock('../../modules/RandomAnimeService', () => {
  const MockRandomAnimeService = jest.fn(() => mockRandom);
  Object.defineProperty(MockRandomAnimeService, 'commandDefinition', {
    get: () => mockRealRandom.commandDefinition
  });
  return MockRandomAnimeService;
});
jest.mock('../../modules/AnimeStatsService', () => {
  const MockAnimeStatsService = jest.fn(() => mockStats);
  Object.defineProperty(MockAnimeStatsService, 'commandDefinition', {
    get: () => mockRealStats.commandDefinition
  });
  return MockAnimeStatsService;
});
jest.mock('../../modules/animeRecommendation', () => {
  const MockAnimeRecommendationService = jest.fn(() => mockRecommendation);
  Object.defineProperty(MockAnimeRecommendationService, 'commandDefinition', {
    get: () => mockRealRecommendation.commandDefinition
  });
  return MockAnimeRecommendationService;
});
jest.mock('../../modules/AnimeCoverService', () => {
  const MockAnimeCoverService = jest.fn(() => mockCover);
  Object.defineProperty(MockAnimeCoverService, 'commandDefinition', {
    get: () => mockRealCover.commandDefinition
  });
  return MockAnimeCoverService;
});

// Keep real SlashCommandBuilder/EmbedBuilder; only Client is faked
jest.mock('discord.js', () => ({
  ...jest.requireActual('discord.js'),
  Client: jest.fn()
}));

const mockApp = { get: jest.fn(), listen: jest.fn() };
const mockServer = { close: jest.fn((cb) => cb && cb()) };

jest.mock('express', () => jest.fn(() => mockApp));

describe('AniListDiscordBot', () => {
  let bot;
  let mockClient;

  const handlerFor = (mockFn, event) => {
    const found = mockFn.mock.calls.find(([name]) => name === event);
    expect(found).toBeDefined();
    return found[1];
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockClient = {
      on: jest.fn(),
      once: jest.fn(),
      isReady: jest.fn(() => true),
      destroy: jest.fn().mockResolvedValue(undefined),
      login: jest.fn().mockResolvedValue('token'),
      user: { tag: 'TestBot#0001' },
      guilds: { cache: new Map() }
    };
    Client.mockImplementation(() => mockClient);

    mockApp.get.mockReturnValue(undefined);
    mockApp.listen.mockReturnValue(mockServer);
    mockServer.close.mockImplementation((cb) => cb && cb());

    // Intercept process-level registration/exit before the bot installs its handlers
    jest.spyOn(process, 'on').mockImplementation(() => process);
    jest.spyOn(process, 'exit').mockImplementation(() => undefined);

    bot = new AniListDiscordBot('test-token');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    test('creates a Discord client with the required intents', () => {
      expect(Client).toHaveBeenCalledWith({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
      });
    });

    test('instantiates the four services', () => {
      const RandomAnimeService = require('../../modules/RandomAnimeService');
      const AnimeStatsService = require('../../modules/AnimeStatsService');
      const AnimeRecommendationService = require('../../modules/animeRecommendation');
      const AnimeCoverService = require('../../modules/AnimeCoverService');

      expect(RandomAnimeService).toHaveBeenCalledTimes(1);
      expect(AnimeStatsService).toHaveBeenCalledTimes(1);
      expect(AnimeRecommendationService).toHaveBeenCalledTimes(1);
      expect(AnimeCoverService).toHaveBeenCalledTimes(1);

      expect(bot.randomAnimeService).toBe(mockRandom);
      expect(bot.animeStatsService).toBe(mockStats);
      expect(bot.recommendationService).toBe(mockRecommendation);
      expect(bot.animeCoverService).toBe(mockCover);
    });

    test('starts the metrics server and initializes state', () => {
      expect(mockApp.listen).toHaveBeenCalledWith('9911', expect.any(Function));
      expect(bot.httpServer).toBe(mockServer);
      expect(bot.isShuttingDown).toBe(false);
      expect(bot.accessToken).toBeNull();
      expect(bot.tokenExpiresAt).toBe(0);
    });

    test('logs in to Discord during setup', () => {
      expect(mockClient.login).toHaveBeenCalledWith('test-token');
    });

    test('registers process handlers for SIGINT, SIGTERM and unhandledRejection', () => {
      const events = process.on.mock.calls.map(([event]) => event);

      expect(events).toEqual(expect.arrayContaining(['SIGINT', 'SIGTERM', 'unhandledRejection']));
    });
  });

  describe('registerSlashCommands', () => {
    test('bulk-overwrites the four command builders as JSON', async () => {
      const guild = { id: 'g1', commands: { set: jest.fn().mockResolvedValue(undefined) } };

      await bot.registerSlashCommands(guild);

      expect(guild.commands.set).toHaveBeenCalledTimes(1);
      const commands = guild.commands.set.mock.calls[0][0];
      expect(commands.map(command => command.name)).toEqual([
        'animerandom', 'animestats', 'animerecommend', 'animecover'
      ]);
    });

    test('logs the registered command count for the guild', async () => {
      const guild = { id: 'g1', commands: { set: jest.fn().mockResolvedValue(undefined) } };

      await bot.registerSlashCommands(guild);

      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('4 slash commands for guild g1')
      );
    });

    test('propagates registration failures to the caller', async () => {
      const guild = {
        id: 'g1',
        commands: { set: jest.fn().mockRejectedValue(new Error('discord down')) }
      };

      await expect(bot.registerSlashCommands(guild)).rejects.toThrow('discord down');
    });
  });

  describe('interactionCreate handler', () => {
    const onInteractionCreate = () => handlerFor(mockClient.on, 'interactionCreate');

    test('dispatches each command to its service method', async () => {
      const handler = onInteractionCreate();
      const commands = [
        ['animerandom', mockRandom, 'handleRandomAnimeCommand'],
        ['animestats', mockStats, 'handleAnimeStatsCommand'],
        ['animerecommend', mockRecommendation, 'handleAnimeRecommendCommand'],
        ['animecover', mockCover, 'handleAnimeCoverCommand']
      ];

      for (const [name, service, method] of commands) {
        const interaction = createMockInteraction({ commandName: name });
        service[method].mockResolvedValue(undefined);

        await handler(interaction);

        expect(service[method]).toHaveBeenCalledWith(interaction);
      }
    });

    test('tracks the command with its metric name and guild id', async () => {
      const metrics = require('../../metrics');
      const handler = onInteractionCreate();
      const interaction = createMockInteraction({ commandName: 'animerandom' });

      await handler(interaction);

      expect(metrics.trackCommand).toHaveBeenCalledWith('anime_random', 'guild-123');
    });

    test('ends the command timer with success when the handler resolves', async () => {
      const metrics = require('../../metrics');
      const handler = onInteractionCreate();

      await handler(createMockInteraction());

      const endTimer = metrics.trackCommand.mock.results[0].value;
      expect(endTimer).toHaveBeenCalledWith('success');
    });

    test('ends the timer with failure and logs when the handler throws', async () => {
      const metrics = require('../../metrics');
      const handler = onInteractionCreate();
      mockRandom.handleRandomAnimeCommand.mockRejectedValueOnce(new Error('boom'));

      await handler(createMockInteraction());

      const endTimer = metrics.trackCommand.mock.results[0].value;
      expect(endTimer).toHaveBeenCalledWith('failure');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled error from /animerandom'),
        expect.any(Object)
      );
    });

    test('tolerates trackCommand returning undefined', async () => {
      const metrics = require('../../metrics');
      const handler = onInteractionCreate();
      metrics.trackCommand.mockReturnValueOnce(undefined);

      await expect(handler(createMockInteraction())).resolves.toBeUndefined();
      expect(mockRandom.handleRandomAnimeCommand).toHaveBeenCalled();
    });

    test('ignores non-chat-input interactions', async () => {
      const metrics = require('../../metrics');
      const handler = onInteractionCreate();
      const interaction = createMockInteraction({ isChatInputCommand: jest.fn(() => false) });

      await handler(interaction);

      expect(mockRandom.handleRandomAnimeCommand).not.toHaveBeenCalled();
      expect(metrics.trackCommand).not.toHaveBeenCalled();
    });

    test('ignores unknown command names', async () => {
      const metrics = require('../../metrics');
      const handler = onInteractionCreate();
      const interaction = createMockInteraction({ commandName: 'unknowncmd' });

      await handler(interaction);

      expect(mockRandom.handleRandomAnimeCommand).not.toHaveBeenCalled();
      expect(metrics.trackCommand).not.toHaveBeenCalled();
    });
  });

  describe('ready handler', () => {
    test('logs the bot tag and registers commands for every guild', async () => {
      const g1 = { id: 'g1', commands: { set: jest.fn().mockResolvedValue(undefined) } };
      const g2 = { id: 'g2', commands: { set: jest.fn().mockResolvedValue(undefined) } };
      mockClient.guilds.cache = new Map([['g1', g1], ['g2', g2]]);

      const ready = handlerFor(mockClient.once, 'ready');
      await ready();

      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('TestBot#0001'));
      expect(g1.commands.set).toHaveBeenCalled();
      expect(g2.commands.set).toHaveBeenCalled();
    });

    test('continues to later guilds when one guild fails', async () => {
      const g1 = { id: 'g1', commands: { set: jest.fn().mockRejectedValue(new Error('boom')) } };
      const g2 = { id: 'g2', commands: { set: jest.fn().mockResolvedValue(undefined) } };
      mockClient.guilds.cache = new Map([['g1', g1], ['g2', g2]]);

      const ready = handlerFor(mockClient.once, 'ready');
      await ready();

      expect(g2.commands.set).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('g1'),
        expect.any(Object)
      );
    });
  });

  describe('/metrics endpoint', () => {
    const metricsRoute = () => {
      const found = mockApp.get.mock.calls.find(([path]) => path === '/metrics');
      expect(found).toBeDefined();
      return found[1];
    };

    test('serves metrics with the prometheus content type', async () => {
      const metrics = require('../../metrics');
      metrics.getMetrics.mockResolvedValue('# HELP anilist_bot_commands_total 2');
      const res = { set: jest.fn(), send: jest.fn(), status: jest.fn(() => res) };

      await metricsRoute()({}, res);

      expect(res.set).toHaveBeenCalledWith(
        'Content-Type',
        require('prom-client').register.contentType
      );
      expect(res.send).toHaveBeenCalledWith('# HELP anilist_bot_commands_total 2');
    });

    test('returns 500 when metric collection fails', async () => {
      const metrics = require('../../metrics');
      metrics.getMetrics.mockRejectedValue(new Error('collect failed'));
      const res = { set: jest.fn(), send: jest.fn(), status: jest.fn(() => res) };

      await metricsRoute()({}, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.send).toHaveBeenCalledWith(expect.stringContaining('Failed to retrieve metrics'));
      expect(logger.error).toHaveBeenCalledWith('Failed to retrieve metrics', expect.any(Object));
    });
  });

  describe('shutdown', () => {
    test('destroys the client, closes the http server and exits 0 on SIGINT', async () => {
      await handlerFor(process.on, 'SIGINT')('SIGINT');

      expect(mockClient.destroy).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Shutdown complete'));
    });

    test('handles SIGTERM the same way', async () => {
      await handlerFor(process.on, 'SIGTERM')('SIGTERM');

      expect(mockClient.destroy).toHaveBeenCalled();
      expect(mockServer.close).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    test('ignores a second signal (idempotent)', async () => {
      const shutdown = handlerFor(process.on, 'SIGINT');

      await shutdown('SIGINT');
      await shutdown('SIGINT');

      expect(mockClient.destroy).toHaveBeenCalledTimes(1);
      expect(mockServer.close).toHaveBeenCalledTimes(1);
      expect(process.exit).toHaveBeenCalledTimes(1);
    });

    test('skips destroying a client that is not ready', async () => {
      mockClient.isReady.mockReturnValue(false);

      await handlerFor(process.on, 'SIGINT')('SIGINT');

      expect(mockClient.destroy).not.toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    test('still exits 0 when closing the server throws', async () => {
      mockServer.close.mockImplementation(() => {
        throw new Error('close failed');
      });

      await handlerFor(process.on, 'SIGINT')('SIGINT');

      expect(logger.error).toHaveBeenCalledWith('Error during shutdown', expect.any(Object));
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });

  describe('unhandledRejection handler', () => {
    test('logs Error and non-Error reasons without exiting', () => {
      const handler = handlerFor(process.on, 'unhandledRejection');

      handler(new Error('boom'));
      handler('a string');

      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(process.exit).not.toHaveBeenCalled();
    });
  });
});
