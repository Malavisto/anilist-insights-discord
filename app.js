const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const client = require('@prometheus-io/client');

// Import modular services
const AnimeRecommendationService = require('./modules/commands/AnimeRecommendationService');
const RandomAnimeService = require('./modules/commands/RandomAnimeService');
const AnimeStatsService = require('./modules/commands/AnimeStatsService');
const AnimeCoverService = require('./modules/commands/AnimeCoverService');
const RandomMangaService = require('./modules/commands/RandomMangaService');
const metricsService = require('./modules/observability/metrics');

const logger = require('./modules/observability/logger');

// Main Bot Logic
class AniListDiscordBot {
  constructor(token) {
    // Discord bot configuration with required intents
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    logger.info('AniListDiscordBot initialized');

    // Discord bot token
    this.TOKEN = token;
    this.httpServer = null;
    this.isShuttingDown = false;

    const services = [
      ['randomAnimeService', RandomAnimeService],
      ['randomMangaService', RandomMangaService],
      ['animeStatsService', AnimeStatsService],
      ['recommendationService', AnimeRecommendationService],
      ['animeCoverService', AnimeCoverService],
    ];
    this.commands = services.map(([property, Service]) => {
      const service = new Service();
      this[property] = service;
      return { ...Service.commandDefinition, service };
    });
    this.commandHandlers = new Map(this.commands.map((command) => [command.builder.name, command]));

    this.setupEventListeners();
  }

  start() {
    if (this.startPromise) return this.startPromise;
    this.setupProcessHandlers();
    this.startPromise = (async () => {
      try {
        await Promise.all([
          this.setupMetricsServer(),
          Promise.resolve().then(async () => {
            await this.client.login(this.TOKEN);
            if (this.isShuttingDown) await this.client.destroy();
          }),
        ]);
        if (this.isShuttingDown) throw new Error('Startup interrupted');
        return this;
      } catch (error) {
        const message = String(error?.message || error);
        const safeMessage = this.TOKEN ? message.split(this.TOKEN).join('[REDACTED]') : message;
        logger.error('Bot startup failed', { error: safeMessage });
        process.exitCode = 1;
        await this.shutdown();
        // Preserve diagnostics without retaining a credential-bearing original cause.
        // eslint-disable-next-line preserve-caught-error
        throw new Error('Bot startup failed', { cause: new Error(safeMessage) });
      }
    })();
    return this.startPromise;
  }

  setupMetricsServer() {
    const app = express();
    const PORT = process.env.METRICS_PORT || 9090;

    app.get('/readyz', (req, res) => {
      const ready = this.httpServer?.listening && this.client.isReady() && !this.isShuttingDown;
      res.status(ready ? 200 : 503).send(ready ? 'Ready' : 'Not ready');
    });

    // Prometheus metrics endpoint
    app.get('/metrics', async (req, res) => {
      try {
        const metrics = await metricsService.getMetrics();
        res.set('Content-Type', client.register.contentType);
        res.send(metrics);
      } catch (error) {
        logger.error('Failed to retrieve metrics', {
          error: error.message,
          stack: error.stack,
        });
        res.status(500).send('Failed to retrieve metrics');
      }
    });
    return new Promise((resolve, reject) => {
      this.httpServer = app.listen(PORT, () => {
        if (this.isShuttingDown) this.httpServer.close(() => {});
        resolve();
      });
      this.httpServer.once('error', reject);
    });
  }

  shutdown() {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.isShuttingDown = true;
    this.shutdownPromise = (async () => {
      let timer;
      const cleanup = [
        () => this.client.destroy(),
        ...this.commands.map(
          ({ service }) =>
            () =>
              service.cache?.destroy(),
        ),
        () =>
          this.httpServer &&
          new Promise((resolve, reject) =>
            this.httpServer.close((error) => (error ? reject(error) : resolve())),
          ),
      ];
      try {
        await Promise.race([
          Promise.allSettled(cleanup.map((fn) => Promise.resolve().then(fn))).then((results) => {
            if (results.some((result) => result.status === 'rejected'))
              logger.error('Error during shutdown', {});
          }),
          new Promise((resolve) => {
            timer = setTimeout(() => {
              process.exitCode = 1;
              resolve();
            }, 10000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        logger.info('Shutdown complete');
      }
    })();
    return this.shutdownPromise;
  }

  setupProcessHandlers() {
    const shutdown = async () => {
      await this.shutdown();
      if (!this.exited) {
        this.exited = true;
        process.exit(process.exitCode || 0);
      }
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Log stray promise rejections instead of letting them crash the process
    process.on('unhandledRejection', (reason) => {
      logger.error('Unhandled promise rejection', {
        error: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      });
    });
  }

  setupEventListeners() {
    // Bot is ready - register slash commands
    this.client.once('ready', async () => {
      logger.info(`Logged in as ${this.client.user.tag}`);

      // Get all guilds the bot is in and register commands
      for (const guild of this.client.guilds.cache.values()) {
        try {
          await this.registerSlashCommands(guild);
        } catch (error) {
          logger.error(`Failed to register commands for guild ${guild.id}`, {
            error: error.message,
            stack: error.stack,
          });
        }
      }
    });

    this.client.on('guildCreate', async (guild) => {
      try {
        await this.registerSlashCommands(guild);
      } catch {
        logger.error(`Failed to register commands for guild ${guild.id}`);
      }
    });

    // Error handling
    this.client.on('error', (error) => {
      logger.error('Discord client error', { error });
    });

    // Interaction create event (handles slash commands)
    this.client.on('interactionCreate', async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const handler = this.commandHandlers.get(interaction.commandName);
      if (!handler) return;

      const { service, methodName, metricName } = handler;
      let endTimer;
      let failed = false;
      try {
        endTimer = metricsService.trackCommand(metricName, interaction.guildId);
        failed = (await service[methodName](interaction)) === false;
      } catch (error) {
        failed = true;
        // Errors are already logged and reported to the user by each service
        logger.error(`Unhandled error from /${interaction.commandName}`, {
          error: error.message,
          stack: error.stack,
        });
      } finally {
        if (typeof endTimer === 'function') {
          endTimer(failed ? 'failure' : 'success');
        }
      }
    });
  }

  async registerSlashCommands(guild) {
    // Bulk overwrite replaces existing commands instead of duplicating them
    await guild.commands.set(this.commands.map(({ builder }) => builder.toJSON()));
    logger.info(`Registered ${this.commands.length} slash commands for guild ${guild.id}`);
  }
}

// Usage
async function initializeBot() {
  const bot = new AniListDiscordBot(process.env.DISCORD_TOKEN);
  await bot.start();
  return bot;
}

// Only boot when run directly (bun app.js / bun start); requiring the
// module must not start the bot
if (require.main === module) {
  initializeBot().catch(() => process.exit(1));
}

module.exports = { AniListDiscordBot, initializeBot };
