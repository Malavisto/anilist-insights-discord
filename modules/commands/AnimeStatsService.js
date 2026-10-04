const anilistRequest = require('../shared/anilistRequest');
const replyError = require('../shared/replyError');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const logger = require('../observability/logger');
const metricsService = require('../observability/metrics');
const CacheService = require('../shared/CacheService');

// Main Logic
class AnimeStatsService {
  // /animestats slash-command
  static get commandDefinition() {
    return {
      builder: new SlashCommandBuilder()
        .setName('animestats')
        .setDescription('Get anime stats for an AniList user')
        .addStringOption((option) =>
          option
            .setName('username')
            .setDescription('AniList username to fetch stats from')
            .setRequired(true),
        ),
      methodName: 'handleAnimeStatsCommand',
      metricName: 'anime_stats',
    };
  }

  constructor() {
    this.cache = new CacheService(300000, 'AnimeStats');
  }

  async fetchUserAnimeStats(username) {
    try {
      // Check cache first
      const cachedStats = this.cache.get(`stats_${username}`);
      if (cachedStats) {
        metricsService.trackCacheHit('anime_stats');

        return { ...cachedStats, source: 'cache' };
      }
      const query = `
            query ($username: String) {
                User(name: $username) {
                    id
                    name
                }
                MediaListCollection(userName: $username, type: ANIME) {
                    lists {
                        entries {
                            mediaId
                            status
                            score
                            media {
                                averageScore
                            }
                        }
                    }
                }
            }
            `;

      const response = await anilistRequest(query, { username }, 'anime_stats', username);
      if (!response.data.data.User) {
        throw new Error(`User ${username} not found on AniList`);
      }

      const lists = response.data.data.MediaListCollection.lists;

      // Custom lists can repeat entries; media IDs identify unique anime.
      const entriesById = new Map();
      for (const entry of lists.flatMap((list) => list.entries)) {
        entriesById.set(entry.mediaId ?? entry, entry);
      }
      const allEntries = [...entriesById.values()];
      const countStatus = (...statuses) =>
        allEntries.filter((entry) => statuses.includes(entry.status)).length;
      const stats = {
        totalAnime: allEntries.length,
        completedAnime: countStatus('COMPLETED'),
        watchingAnime: countStatus('CURRENT', 'REPEATING'),
        pausedAnime: countStatus('PAUSED'),
        droppedAnime: countStatus('DROPPED'),
        planningAnime: countStatus('PLANNING'),
        averageScore: 0,
      };

      // Calculate the user's own average score (unrated entries score 0)
      const validScores = allEntries
        .map((entry) => entry.score)
        .filter((score) => score !== null && score > 0);

      if (validScores.length > 0) {
        stats.averageScore = (validScores.reduce((a, b) => a + b, 0) / validScores.length).toFixed(
          2,
        );
      }

      // Cache the result
      this.cache.set(`stats_${username}`, stats);
      return { ...stats, source: 'anilist' };
    } catch (error) {
      metricsService.trackError('fetch_failure', 'anime_stats');

      logger.error('Anime stats fetch failed', {
        username,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      throw error;
    }
  }

  createAnimeStatsEmbed(username, stats) {
    const embed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`📊 Anime Stats for ${username}`)
      .addFields(
        {
          name: '📈 Total Anime',
          value: `🌟 ${stats.totalAnime}`,
          inline: true,
        },
        {
          name: '✅ Completed',
          value: `🏆 ${stats.completedAnime}`,
          inline: true,
        },
        {
          name: '📺 Currently Watching',
          value: `🔴 ${stats.watchingAnime}`,
          inline: true,
        },
        {
          name: '⏸️ Paused',
          value: `⏳ ${stats.pausedAnime}`,
          inline: true,
        },
        {
          name: '❌ Dropped',
          value: `🗑️ ${stats.droppedAnime}`,
          inline: true,
        },
        {
          name: '📅 Planning to Watch',
          value: `📝 ${stats.planningAnime}`,
          inline: true,
        },
        {
          name: '⭐ Average Score',
          value: `🌈 ${stats.averageScore || 'N/A'}`,
          inline: true,
        },
      )
      .setFooter({
        text: stats.source === 'cache' ? 'Stats served from Cache' : 'Stats fetched from AniList',
      });

    return embed;
  }

  async handleAnimeStatsCommand(interaction) {
    try {
      // Immediately defer the reply to prevent timeout
      await interaction.deferReply({ ephemeral: false });

      const username = interaction.options.getString('username');

      // Early validation with quick response
      if (!username) {
        // Note: visibility is fixed by deferReply above, so this posts publicly
        await interaction.editReply({
          content: '❌ Please provide a valid AniList username.',
        });
        return false;
      }

      try {
        const stats = await this.fetchUserAnimeStats(username);

        const statsEmbed = this.createAnimeStatsEmbed(username, stats);

        await interaction.editReply({
          embeds: [statsEmbed],
        });
        return true;
      } catch (fetchError) {
        logger.error('Anime stats command processing error', {
          username,
          errorMessage: fetchError.message,
          errorStack: fetchError.stack,
        });

        // Guaranteed response to prevent "thinking" state
        await interaction.editReply({
          content: `❌ Error fetching anime stats for ${username}. Possible reasons:
            - Invalid AniList username
            - Empty anime list
            - AniList API temporarily unavailable
            - Network connectivity issues`,
        });
        return false;
      }
    } catch (globalError) {
      // Last-resort error handling
      logger.error('Critical error in anime stats command', {
        errorMessage: globalError.message,
        errorStack: globalError.stack,
      });

      await replyError(
        interaction,
        '❌ An unexpected error occurred. Please try again later.',
        globalError,
      );
      return false;
    }
  }
}

module.exports = AnimeStatsService;
