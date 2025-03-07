const axios = require('axios');
const { EmbedBuilder } = require('discord.js');

// Use same logger and metricsService pattern as in other modules
const logger = require('../logger');
const metricsService = require('../metrics');

class AnimeCoverService {
    /**
     * Fetch a high-quality anime cover image by ID from AniList.
     * Returns the extraLarge cover image URL or null if not found.
     * Uses logger and metricsService similar to existing modules.
     * @param {number} animeId 
     * @param {string} username - Discord username for metrics logging
     */
    async fetchAnimeCoverById(animeId, username) {
        const query = `
            query ($id: Int) {
                Media(id: $id, type: ANIME) {
                    coverImage {
                        extraLarge
                    }
                }
            }
        `;

        try {
            const response = await axios.post(
                'https://graphql.anilist.co',
                {
                    query,
                    variables: { id: parseInt(animeId) }
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                    }
                }
            );

            const result = response.data?.data?.Media?.coverImage?.extraLarge || null;
            return result;
        } catch (error) {
            logger.error('Failed to fetch anime cover', {
                username,
                errorMessage: error.message,
                errorStack: error.stack
            });
            // Track an error event and API request status
            metricsService.trackError('cover_fetch_failure', 'anime_cover');
            metricsService.trackApiRequest('anime_cover', 'failure', username);

            throw error; // Let the caller handle response
        }
    }

    /**
     * Handles the slash command interaction for fetching and displaying the anime cover.
     * Follows the same logger & metrics pattern as existing modules.
     * @param {CommandInteraction} interaction 
     */
    async handleAnimeCoverCommand(interaction) {
        const username = interaction.user.username;
        let coverImage = null;

        try {
            // Defer in case the external API call takes some time
            await interaction.deferReply();

            // Get animeId from the slash command's options
            // Fixed: Using getString instead of getInteger since the option is defined as STRING type
            const animeIdStr = interaction.options.getString('animeid');
            if (!animeIdStr || isNaN(parseInt(animeIdStr))) {
                await interaction.editReply('Please provide a valid anime ID.');
                return;
            }

            const animeId = parseInt(animeIdStr);

            // Attempt to fetch the cover
            coverImage = await this.fetchAnimeCoverById(animeId, username);

            // If we have a cover, send success metrics, else fail gracefully
            if (!coverImage) {
                // Possibly track as a "failure" due to no cover
                metricsService.trackApiRequest('anime_cover', 'failure', username);
                await interaction.editReply('No cover image found for that anime ID.');
                return;
            }

            // We have a successful response
            metricsService.trackApiRequest('anime_cover', 'success', username);

            // Construct embed with the fetched cover image
            const embed = new EmbedBuilder()
                .setTitle(`Anime Cover for ID: ${animeId}`)
                .setImage(coverImage);

            await interaction.editReply({ embeds: [embed] });
            
        } catch (globalError) {
            logger.error('Critical error in anime cover command', {
                username,
                errorMessage: globalError.message,
                errorStack: globalError.stack
            });

            try {
                // Attempt to send an error message
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: "❌ An error occurred while fetching the anime cover.",
                        ephemeral: true
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply({
                        content: "❌ An error occurred while fetching the anime cover.",
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                logger.error('Failed to send final error message', {
                    username,
                    originalError: globalError,
                    replyError
                });
            }
        }
    }
}

module.exports = AnimeCoverService;