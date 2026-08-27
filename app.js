const { Client, GatewayIntentBits} = require('discord.js');
const express = require('express');
const client = require('prom-client');

// Import modular services
const AnimeRecommendationService = require('./modules/animeRecommendation');
const RandomAnimeService = require('./modules/RandomAnimeService');
const AnimeStatsService = require('./modules/AnimeStatsService');
const AnimeCoverService = require('./modules/AnimeCoverService');
const metricsService = require('./metrics');

const logger = require('./logger');
require('dotenv').config();

const dis_token = process.env.DISCORD_TOKEN;

// Main Bot Logic
class AniListDiscordBot {
    constructor(token) {
        // Discord bot configuration with required intents
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages
            ]
        });
        logger.info('AniListDiscordBot initialized');

        // Discord bot token
        this.TOKEN = dis_token;
        this.httpServer = null;
        this.isShuttingDown = false;

        // Initialize services
        this.recommendationService = new AnimeRecommendationService();
        this.randomAnimeService = new RandomAnimeService();
        this.animeStatsService = new AnimeStatsService();
        this.animeCoverService = new AnimeCoverService();

        this.setupMetricsServer();

        this.setupEventListeners();
        this.setupProcessHandlers();

        this.accessToken = null;
        this.tokenExpiresAt = 0;
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
                    stack: error.stack
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

                if (this.httpServer) {
                    await new Promise((resolve) => this.httpServer.close(resolve));
                }

                logger.info('Shutdown complete');
            } catch (error) {
                logger.error('Error during shutdown', {
                    error: error.message,
                    stack: error.stack
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
                stack: reason instanceof Error ? reason.stack : undefined
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
                        stack: error.stack
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

            // Define services for command handling
            const randomDef = RandomAnimeService.commandDefinition;
            const statsDef = AnimeStatsService.commandDefinition;
            const recommendationDef = AnimeRecommendationService.commandDefinition;
            const coverDef = AnimeCoverService.commandDefinition;

            const commandHandlers = {
                [randomDef.builder.name]: [this.randomAnimeService, randomDef.methodName, randomDef.metricName],
                [statsDef.builder.name]: [this.animeStatsService, statsDef.methodName, statsDef.metricName],
                [recommendationDef.builder.name]: [this.recommendationService, recommendationDef.methodName, recommendationDef.metricName],
                [coverDef.builder.name]: [this.animeCoverService, coverDef.methodName, coverDef.metricName]
            };

            const handler = commandHandlers[interaction.commandName];
            if (!handler) return; // Unknown command - nothing to do

            const [service, methodName, metricName] = handler;
            let endTimer;
            let failed = false;
            try {
                endTimer = metricsService.trackCommand(metricName, interaction.guildId);
                await service[methodName](interaction);
            } catch (error) {
                failed = true;
                // Errors are already logged and reported to the user by each service
                logger.error(`Unhandled error from /${interaction.commandName}`, {
                    error: error.message,
                    stack: error.stack
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
        const commands = [
            // Random anime command
            RandomAnimeService.commandDefinition.builder,
            // Anime stats command
            AnimeStatsService.commandDefinition.builder,
            // Anime recommendation command
            AnimeRecommendationService.commandDefinition.builder,
            // Anime cover command
            AnimeCoverService.commandDefinition.builder
        ];

        // Bulk overwrite replaces existing commands instead of duplicating them
        await guild.commands.set(commands.map(command => command.toJSON()));
        logger.info(`Registered ${commands.length} slash commands for guild ${guild.id}`);
    }
}

// Usage
function initializeBot() {
    const bot = new AniListDiscordBot(dis_token);
}

initializeBot();
