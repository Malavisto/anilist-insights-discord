const { cleanDescription: sanitizeDescription, isValidHttpUrl } = require('../shared/embedHelpers');
const anilistRequest = require('../shared/anilistRequest');
const replyError = require('../shared/replyError');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const logger = require('../observability/logger');
const metricsService = require('../observability/metrics');
const CacheService = require('../shared/CacheService');

// Main Logic
class AnimeRecommendationService {
  constructor() {
    this.cache = new CacheService(300000, 'AnimeRecommendation');
  }

  // /animerecommend slash-command
  static get commandDefinition() {
    return {
      builder: new SlashCommandBuilder()
        .setName('animerecommend')
        .setDescription('Get an anime recommendation based on your list')
        .addStringOption((option) =>
          option
            .setName('username')
            .setDescription('AniList username to generate recommendation from')
            .setRequired(true),
        ),
      methodName: 'handleAnimeRecommendCommand',
      metricName: 'anime_recommendation',
    };
  }

  async fetchAnimeRecommendation(username) {
    try {
      // Cache the candidate pool, selecting again for each command.
      const cachedPool = this.cache.get(`recommendation_${username}`);
      if (cachedPool) {
        metricsService.trackCacheHit('anime_recommendation');

        return this.selectRecommendation(cachedPool);
      }

      const query = `
            query ($username: String) {
                MediaListCollection(userName: $username, type: ANIME) {
                    lists {
                        entries {
                            mediaId
                            status
                            score
                            media {
                                id
                                title {
                                    english
                                    romaji
                                }
                                genres
                            }
                        }
                    }
                }
            }
            `;

      // Fetch user's media list
      const response = await anilistRequest(query, { username }, 'recommendation', username);

      // Get user's anime list and find highest-rated anime
      const lists = response.data.data.MediaListCollection.lists;
      const allEntries = lists.flatMap((list) => list.entries);

      // Sort entries by score, get highest-rated anime
      const highestRatedEntries = allEntries
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3); // Take top 3 highest-rated anime

      if (highestRatedEntries.length === 0) {
        throw new Error('No rated anime found in list');
      }

      // Use genres from highest-rated anime to find similar recommendations
      const genresOfInterest = highestRatedEntries
        .flatMap((entry) => entry.media.genres)
        .filter((genre, index, self) => self.indexOf(genre) === index)
        .slice(0, 3); // Limit to top 3 genres

      // Second query to find recommendations based on genres
      const recommendationQuery = `
            query ($genres: [String], $page: Int) {
                Page(page: $page, perPage: 5) {
                    pageInfo {
                        hasNextPage
                    }
                    media(
                        genre_in: $genres,
                        type: ANIME,
                        sort: POPULARITY_DESC
                    ) {
                        id
                        title {
                            english
                            romaji
                        }
                        description
                        episodes
                        format
                        status
                        genres
                        averageScore
                        seasonYear
                        coverImage {
                            extraLarge
                            large
                        }
                    }
                }
            }
            `;

      const listedIds = new Set(allEntries.map((entry) => entry.media.id));
      const uniqueRecommendations = new Map();
      let page = 1;
      // Collect up to five unseen titles, continuing when a page has too few.
      while (uniqueRecommendations.size < 5) {
        const recommendationResponse = await anilistRequest(
          recommendationQuery,
          { genres: genresOfInterest, page },
          'recommendation',
          username,
        );
        const result = recommendationResponse.data.data.Page;
        for (const anime of result.media) {
          if (!listedIds.has(anime.id)) uniqueRecommendations.set(anime.id, anime);
          if (uniqueRecommendations.size === 5) break;
        }
        if (uniqueRecommendations.size === 5 || !result.pageInfo?.hasNextPage) break;
        page++;
      }

      if (uniqueRecommendations.size === 0) {
        throw new Error('No unique recommendations found');
      }

      const candidates = [...uniqueRecommendations.values()].map((anime) => ({
        id: anime.id,
        title: anime.title.english || anime.title.romaji,
        description: anime.description,
        episodes: anime.episodes || 'Unknown',
        format: anime.format,
        status: anime.status,
        genres: anime.genres,
        year: anime.seasonYear,
        averageScore: anime.averageScore,
        coverImage: anime.coverImage.extraLarge || anime.coverImage.large,
        matchedGenres: genresOfInterest.filter((genre) => anime.genres.includes(genre)),
      }));
      const pool = { candidates, lastId: null };
      this.cache.set(`recommendation_${username}`, pool);
      return this.selectRecommendation(pool);
    } catch (error) {
      metricsService.trackError('recommendation_failure', 'anime_recommend');

      logger.error('Anime recommendation fetch failed', {
        username,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      throw error;
    }
  }

  selectRecommendation(pool) {
    // Avoid consecutive repeats when there is more than one candidate.
    const choices =
      pool.candidates.length > 1
        ? pool.candidates.filter((anime) => anime.id !== pool.lastId)
        : pool.candidates;
    const selected = choices[Math.floor(Math.random() * choices.length)];
    pool.lastId = selected.id;
    return selected;
  }

  createAnimeRecommendationEmbed(username, anime) {
    const cleanDescription = sanitizeDescription(anime.description);

    const animeDirectLink = `https://anilist.co/anime/${anime.id}`;

    const embed = new EmbedBuilder()
      .setColor('#00ff00') // Green color for recommendations
      .setTitle(`🌟 Recommended Anime for ${username}`)
      .setURL(animeDirectLink)
      .setDescription(
        `📝 ${
          cleanDescription.length > 200
            ? cleanDescription.substring(0, 200) + '...'
            : cleanDescription
        }`,
      )
      .addFields(
        {
          name: '🎬 Title',
          value: anime.title,
          inline: false,
        },
        {
          name: '📡 Show Status',
          value: anime.status,
          inline: true,
        },
        {
          name: '🎞️ Episodes',
          value: anime.episodes.toString(),
          inline: true,
        },
        {
          name: '🎭 Format',
          value: anime.format,
          inline: true,
        },
        {
          name: '📅 Year',
          value: anime.year?.toString() || 'Unknown',
          inline: true,
        },
        {
          name: '🏷️ Matched Genres',
          value:
            anime.matchedGenres.length > 0
              ? anime.matchedGenres.map((genre) => `#${genre}`).join(' ')
              : 'No genre matches',
          inline: false,
        },
        {
          name: '📈 Average Score',
          value: `${anime.averageScore || 'N/A'}%`,
          inline: true,
        },
      )
      .setFooter({
        text: '🔗 Click title to view on AniList',
      });

    // Validate and set image if URL is valid

    if (anime.coverImage && isValidHttpUrl(anime.coverImage)) {
      embed.setImage(anime.coverImage);
    }

    return embed;
  }

  async handleAnimeRecommendCommand(interaction) {
    try {
      await interaction.deferReply({ ephemeral: false });

      const username = interaction.options.getString('username');

      if (!username) {
        // Note: visibility is fixed by deferReply above, so this posts publicly
        await interaction.editReply({
          content: '❌ Please provide a valid AniList username.',
        });
        return false;
      }

      try {
        const recommendedAnime = await this.fetchAnimeRecommendation(username);

        const recommendationEmbed = this.createAnimeRecommendationEmbed(username, recommendedAnime);

        await interaction.editReply({
          embeds: [recommendationEmbed],
        });
        return true;
      } catch (fetchError) {
        logger.error('Anime recommendation command processing error', {
          username,
          errorMessage: fetchError.message,
          errorStack: fetchError.stack,
        });

        await interaction.editReply({
          content: `❌ Error fetching anime recommendation for ${username}. Possible reasons:
        - Invalid AniList username
        - No rated anime in list
        - Unable to generate recommendations
        - AniList API temporarily unavailable`,
        });
        return false;
      }
    } catch (globalError) {
      logger.error('Critical error in anime recommendation command', {
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

module.exports = AnimeRecommendationService;
