const { Client, GatewayIntentBits, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
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

            const commandHandlers = {
                randomanime: [this.randomAnimeService, 'handleRandomAnimeCommand', 'random_anime'],
                animestats: [this.animeStatsService, 'handleAnimeStatsCommand', 'anime_stats'],
                animerecommend: [this.recommendationService, 'handleAnimeRecommendCommand', 'anime_recommend'],
                animecover: [this.animeCoverService, 'handleAnimeCoverCommand', 'anime_cover']
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
            new SlashCommandBuilder()
                .setName('randomanime')
                .setDescription('Get a random anime from a user\'s AniList')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('AniList username to fetch anime from')
                        .setRequired(true)
                ),
            // Anime stats command
            new SlashCommandBuilder()
                .setName('animestats')
                .setDescription('Get anime stats for an AniList user')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('AniList username to fetch stats from')
                        .setRequired(true)
                ),
            // Anime recommendation command
            new SlashCommandBuilder()
                .setName('animerecommend')
                .setDescription('Get an anime recommendation based on your list')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('AniList username to generate recommendation from')
                        .setRequired(true)
                ),
            // Anime cover command
            new SlashCommandBuilder()
                .setName('animecover')
                .setDescription('Get the cover image for an anime by ID')
                .addStringOption(option =>
                    option.setName('animeid')
                        .setDescription('AniList anime ID to fetch cover from')
                        .setRequired(true)
                )
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
