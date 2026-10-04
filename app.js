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

const dis_token = process.env.DISCORD_TOKEN;

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

    this.setupMetricsServer();

    this.setupEventListeners();
    this.setupProcessHandlers();
  }

  setupMetricsServer() {
    const app = express();
    const PORT = process.env.METRICS_PORT || 9090;

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
    this.httpServer = app.listen(PORT, () => {
      logger.info(`Metrics server running on port ${PORT}`);
    });
  }

  setupProcessHandlers() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;

      logger.info(`Received ${signal}, shutting down`);

      try {
        if (this.client.isReady()) {
          this.client.destroy();
        }

        for (const { service } of this.commands) {
          service.cache?.destroy();
        }

        if (this.httpServer) {
          await new Promise((resolve) => this.httpServer.close(resolve));
        }

        logger.info('Shutdown complete');
      } catch (error) {
        logger.error('Error during shutdown', {
          error: error.message,
          stack: error.stack,
        });
      } finally {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

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
    // Login to Discord
    this.client.login(this.TOKEN);
  }

  async registerSlashCommands(guild) {
    // Bulk overwrite replaces existing commands instead of duplicating them
    await guild.commands.set(this.commands.map(({ builder }) => builder.toJSON()));
    logger.info(`Registered ${this.commands.length} slash commands for guild ${guild.id}`);
  }
}

// Usage
function initializeBot() {
  return new AniListDiscordBot(dis_token);
}

// Only boot when run directly (bun app.js / bun start); requiring the
// module must not start the bot
if (require.main === module) {
  initializeBot();
}

module.exports = { AniListDiscordBot, initializeBot };
