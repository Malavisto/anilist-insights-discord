const client = require('prom-client');
const logger = require('./logger');

class MetricsService {
    constructor() {
        // Enable default metrics collection
        client.collectDefaultMetrics();

        // Comprehensive command metrics
        this.commandCounter = new client.Counter({
            name: 'anilist_bot_commands_total',
            help: 'Total number of commands executed',
            labelNames: ['command_type', 'guild_id']
        });

        this.commandDuration = new client.Histogram({
            name: 'anilist_bot_command_duration_seconds',
            help: 'Duration of command execution',
            labelNames: ['command_type', 'status']
        });

        this.apiRequestCounter = new client.Counter({
            name: 'anilist_api_requests_total',
            help: 'Total number of requests to AniList API',
            labelNames: ['endpoint', 'status', 'username']
        });

        this.cacheHitCounter = new client.Counter({
            name: 'anilist_bot_cache_hits',
            help: 'Number of cache hits to reduce API calls',
            labelNames: ['cache_type']
        });

        this.userStatsGauge = new client.Gauge({
            name: 'anilist_user_stats',
            help: 'Statistics about users and anime lists',
            labelNames: ['metric_type', 'username']
        });

        // Error tracking
        this.errorCounter = new client.Counter({
            name: 'anilist_bot_errors_total',
            help: 'Total number of errors encountered',
            labelNames: ['error_type', 'command_type']
        });
    }

    // Enhanced command tracking with status
    trackCommand(commandType, guildId) {
        try {
            this.commandCounter.inc({ command_type: commandType, guild_id: guildId });
            return (status = 'success') => {
                const endTimer = this.commandDuration.startTimer({ 
                    command_type: commandType,
                    status 
                });
                endTimer();
            };
        } catch (error) {
            logger.error('Error tracking command metrics', { error });
        }
    }

    // Enhanced API request tracking
    trackApiRequest(endpoint, status, username) {
        try {
            this.apiRequestCounter.inc({ 
                endpoint, 
                status, 
                username: username || 'unknown'
            });
        } catch (error) {
            logger.error('Error tracking API request metrics', { error });
        }
    }

    // Track cache hits
    trackCacheHit(cacheType) {
        try {
            this.cacheHitCounter.inc({ cache_type: cacheType });
        } catch (error) {
            logger.error('Error tracking cache hit', { error });
        }
    }

    // Track errors
    trackError(errorType, commandType) {
        try {
            this.errorCounter.inc({ 
                error_type: errorType, 
                command_type: commandType 
            });
        } catch (error) {
            logger.error('Error tracking error metrics', { error });
        }
    }

    // Update user-specific stats
    updateUserStats(metricType, username, value) {
        try {
            this.userStatsGauge.set({ 
                metric_type: metricType, 
                username 
            }, value);
        } catch (error) {
            logger.error('Error updating user stats metrics', { error });
        }
    }

    // Expose metrics for Prometheus to scrape
    async getMetrics() {
        return client.register.metrics();
    }
}

module.exports = new MetricsService();