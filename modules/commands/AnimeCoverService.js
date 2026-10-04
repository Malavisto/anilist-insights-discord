const anilistRequest = require('../shared/anilistRequest');
const replyError = require('../shared/replyError');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

// Use same logger and metricsService pattern as in other modules
const logger = require('../observability/logger');
const metricsService = require('../observability/metrics');

class AnimeCoverService {
  // /animecover slash-command
  static get commandDefinition() {
    return {
      builder: new SlashCommandBuilder()
        .setName('animecover')
        .setDescription('Get the cover image for an anime by ID')
        .addStringOption((option) =>
          option
            .setName('animeid')
            .setDescription('AniList anime ID to fetch cover from')
            .setRequired(true),
        ),
      methodName: 'handleAnimeCoverCommand',
      metricName: 'anime_cover',
    };
  }

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
      const response = await anilistRequest(
        query,
        { id: parseInt(animeId) },
        'anime_cover',
        username,
      );

      const result = response.data?.data?.Media?.coverImage?.extraLarge || null;
      return result;
    } catch (error) {
      logger.error('Failed to fetch anime cover', {
        username,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      // Track the fetch error separately from HTTP request metrics
      metricsService.trackError('cover_fetch_failure', 'anime_cover');

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
    let coverImage;

    try {
      // Defer in case the external API call takes some time
      await interaction.deferReply();

      // Get animeId from the slash command's options
      // Fixed: Using getString instead of getInteger since the option is defined as STRING type
      const animeIdStr = interaction.options.getString('animeid');
      // Validate that input contains only digits
      if (!animeIdStr || !/^\d+$/.test(animeIdStr)) {
        await interaction.editReply('Please provide a valid anime ID (numbers only).');
        return false;
      }

      const animeId = parseInt(animeIdStr);

      // Attempt to fetch the cover
      coverImage = await this.fetchAnimeCoverById(animeId, username);

      // An empty cover is a command failure even if the HTTP request succeeded.
      if (!coverImage) {
        await interaction.editReply('No cover image found for that anime ID.');
        return false;
      }

      // Construct embed with the fetched cover image
      const embed = new EmbedBuilder()
        .setTitle(`Anime Cover for ID: ${animeId}`)
        .setImage(coverImage);

      await interaction.editReply({ embeds: [embed] });
      return true;
    } catch (globalError) {
      logger.error('Critical error in anime cover command', {
        username,
        errorMessage: globalError.message,
        errorStack: globalError.stack,
      });

      await replyError(
        interaction,
        '❌ An error occurred while fetching the anime cover.',
        globalError,
      );
      return false;
    }
  }
}

module.exports = AnimeCoverService;
