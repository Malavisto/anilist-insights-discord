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

        // Initialize services
        this.recommendationService = new AnimeRecommendationService();
        this.randomAnimeService = new RandomAnimeService();
        this.animeStatsService = new AnimeStatsService();
        this.animeCoverService = new AnimeCoverService();

        this.setupMetricsServer();

        this.setupEventListeners();

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
        app.listen(PORT, () => {
            logger.info(`Metrics server running on port ${PORT}`);
        });
    }

    setupEventListeners() {
        // Bot is ready - register slash commands
        this.client.once('ready', async () => {
            logger.info(`Logged in as ${this.client.user.tag}`);

            // Get all guilds the bot is in and register commands
            const guilds = this.client.guilds.cache;
            guilds.forEach(async (guild) => {
                try {
                    await this.registerSlashCommands(guild);
                    logger.info(`Registered commands for guild ${guild.id}`);
                } catch (error) {
                    logger.error(`Failed to register commands for guild ${guild.id}:`, error);
                }
            });
        });

        // Error handling
        this.client.on('error', (error) => {
            logger.error('Discord client error', { error });
        });

        // Interaction create event (handles slash commands)
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            let endTimer;
            try {
                switch (interaction.commandName) {
                    case 'randomanime':
                        endTimer = metricsService.trackCommand('random_anime');
                        await this.randomAnimeService.handleRandomAnimeCommand(interaction);
                        break;
                    case 'animestats':
                        endTimer = metricsService.trackCommand('anime_stats');
                        await this.animeStatsService.handleAnimeStatsCommand(interaction);
                        break;
                    case 'animerecommend':
                        endTimer = metricsService.trackCommand('anime_recommend');
                        await this.recommendationService.handleAnimeRecommendCommand(interaction);
                        break;
                    case 'animecover':
                        endTimer = metricsService.trackCommand('anime_cover');
                        await this.animeCoverService.handleAnimeCoverCommand(interaction);
                        break;
                }
                endTimer(); // Stop the timer
            } catch (error) {
                if (endTimer) endTimer(); // Ensure timer is stopped
                throw error;
            }
        });
        // Login to Discord
        this.client.login(this.TOKEN);
    }

    async registerSlashCommands(guild) {
        // Random anime command
        const randomAnimeCommand = new SlashCommandBuilder()
            .setName('randomanime')
            .setDescription('Get a random anime from a user\'s AniList')
            .addStringOption(option =>
                option.setName('username')
                    .setDescription('AniList username to fetch anime from')
                    .setRequired(true)
            );

        // Anime stats command
        const animeStatsCommand = new SlashCommandBuilder()
            .setName('animestats')
            .setDescription('Get anime stats for an AniList user')
            .addStringOption(option =>
                option.setName('username')
                    .setDescription('AniList username to fetch stats from')
                    .setRequired(true)
            );

        // Anime recommendation command
        const animeRecommendCommand = new SlashCommandBuilder()
            .setName('animerecommend')
            .setDescription('Get an anime recommendation based on your list')
            .addStringOption(option =>
                option.setName('username')
                    .setDescription('AniList username to generate recommendation from')
                    .setRequired(true)
            );

        // Anime cover command
        const animeCoverCommand = new SlashCommandBuilder()
            .setName('animecover')
            .setDescription('Get the cover image for an anime by ID')
            .addStringOption(option =>
                option.setName('animeid')
                    .setDescription('AniList anime ID to fetch cover from')
                    .setRequired(true)
            );

        try {
            // Register commands for the specific guild
            await guild.commands.create(randomAnimeCommand.toJSON());
            await guild.commands.create(animeStatsCommand.toJSON());
            await guild.commands.create(animeRecommendCommand.toJSON());
            await guild.commands.create(animeCoverCommand.toJSON());
            console.log(`Registered slash commands for guild ${guild.id}`);
        } catch (error) {
            console.error(`Failed to register slash commands for guild ${guild.id}:`, error);
        }
    }
}

// Usage
function initializeBot() {
    const bot = new AniListDiscordBot(dis_token);
}

initializeBot();