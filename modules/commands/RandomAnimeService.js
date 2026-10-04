const { cleanDescription: sanitizeDescription, isValidHttpUrl } = require('../shared/embedHelpers');
const anilistRequest = require('../shared/anilistRequest');
const replyError = require('../shared/replyError');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const logger = require('../observability/logger');
const metricsService = require('../observability/metrics');
const CacheService = require('../shared/CacheService');

// Main Logic
class RandomAnimeService {
  constructor() {
    this.cache = new CacheService(300000, 'RandomAnime');
  }

  // /animerandom slash-command
  static get commandDefinition() {
    return {
      builder: new SlashCommandBuilder()
        .setName('animerandom')
        .setDescription("Get a random anime from a user's AniList")
        .addStringOption((option) =>
          option
            .setName('username')
            .setDescription('AniList username to fetch anime from')
            .setRequired(true),
        ),
      methodName: 'handleRandomAnimeCommand',
      metricName: 'anime_random',
    };
  }

  async fetchRandomAnime(username) {
    try {
      const query_ids = `
            query ($username: String) {
                User(name: $username) {
                    id  # Validate user exists first
                }
                MediaListCollection(userName: $username, type: ANIME) {
                    lists {
                        entries {
                            media {
                                id
                            }

                        }
                    }
                }
            }
            `;

      const query_anime = `
            query ($username: String, $id: Int) {
                MediaList(userName: $username, mediaId: $id) {
                            media {
                                id
                                title {
                                    english
                                    romaji
                                }
                                episodes
                                format
                                status
                                genres
                                description
                                averageScore
                                seasonYear
                                coverImage {
                                    large
                                    extraLarge
                                }
                            }
                            status
                            score
                        }
                    }
            `;

      // Check if anime IDs are cached
      const cacheKey = `anime_ids_${username}`;
      let allIDs = this.cache.get(cacheKey);

      if (allIDs) {
        metricsService.trackCacheHit('anime_random');
      } else {
        const response_ids = await anilistRequest(
          query_ids,
          { username },
          'anime_random',
          username,
        );

        if (!response_ids.data.data.User) {
          throw new Error(`User ${username} not found on AniList`);
        }

        allIDs = [
          ...new Set(
            response_ids.data.data.MediaListCollection.lists.flatMap((list) =>
              list.entries.map((entry) => entry.media.id),
            ),
          ),
        ];

        // Cache the IDs for future requests
        this.cache.set(cacheKey, allIDs);
      }

      if (allIDs.length === 0) {
        throw new Error(`No anime found in ${username}'s list`);
      }

      const randomID = allIDs[Math.floor(Math.random() * allIDs.length)];

      const id = randomID;

      const response_anime = await anilistRequest(
        query_anime,
        { username, id },
        'anime_random',
        username,
      );
      if (!response_anime.data.data.MediaList) {
        throw new Error(`No anime data found for user ${username}`);
      }

      const randomAnime = response_anime.data.data.MediaList;

      return {
        id: randomAnime.media.id,
        title: randomAnime.media.title.english || randomAnime.media.title.romaji,
        episodes: randomAnime.media.episodes || 'Unknown',
        format: randomAnime.media.format,
        status: randomAnime.status,
        userScore: randomAnime.score,
        averageScore: randomAnime.media.averageScore,
        genres: randomAnime.media.genres,
        year: randomAnime.media.seasonYear,
        description: randomAnime.media.description,
        coverImage:
          randomAnime.media.coverImage.extraLarge || randomAnime.media.coverImage.large || null,
      };
    } catch (error) {
      metricsService.trackError('fetch_failure', 'anime_random');
      logger.error('Anime fetch failed', {
        username,
        errorMessage: error.message,
        errorStack: error.stack,
      });
      throw error;
    }
  }

  createAnimeEmbed(anime) {
    // Clean up description
    const cleanDescription = sanitizeDescription(anime.description);

    // Direct link to the specific anime page using its ID
    const animeDirectLink = `https://anilist.co/anime/${anime.id}`;

    // Emoji mapping for different statuses and formats
    const statusEmojis = {
      FINISHED: '✅',
      RELEASING: '🔴',
      NOT_YET_RELEASED: '⏳',
      CANCELLED: '❌',
    };

    const formatEmojis = {
      TV: '📺',
      MOVIE: '🎬',
      OVA: '💿',
      SPECIAL: '⭐',
      MUSIC: '🎵',
      ONA: '💻',
      MANGA: '📖',
    };

    const embedBuilder = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle(`🌟 ${anime.title}`)
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
          name: '📡 Status',
          value: `${statusEmojis[anime.status] || '❓'} ${anime.status}`,
          inline: true,
        },
        {
          name: '🎞️ Episodes',
          value: `🔢 ${anime.episodes.toString()}`,
          inline: true,
        },
        {
          name: '🎭 Format',
          value: `${formatEmojis[anime.format] || '🎴'} ${anime.format}`,
          inline: true,
        },
        {
          name: '📅 Year',
          value: `🗓️ ${anime.year?.toString() || 'Unknown'}`,
          inline: true,
        },
        {
          name: '🏷️ Genres',
          value:
            anime.genres.length > 0
              ? anime.genres.map((genre) => `#${genre}`).join(' ')
              : 'No genres',
          inline: false,
        },
        {
          name: '⭐ Your Score',
          value: `📊 ${anime.userScore?.toString() || 'Not rated'}`,
          inline: true,
        },
        {
          name: '📈 Average Score',
          value: `🌈 ${anime.averageScore || 'N/A'}%`,
          inline: true,
        },
      )
      .setFooter({
        text: '🔗 Click title to view on AniList',
      });

    // Add thumbnail only if a valid image URL exists
    if (anime.coverImage && isValidHttpUrl(anime.coverImage)) {
      embedBuilder.setImage(anime.coverImage);
    }

    return embedBuilder;
  }

  async handleRandomAnimeCommand(interaction) {
    // Declared out here so the last-resort catch can still reference it
    // when deferReply fails before the assignment runs
    let username;

    try {
      // Immediately defer the reply to prevent timeout
      await interaction.deferReply({ ephemeral: false });

      username = interaction.options.getString('username');

      // Early validation with quick response
      if (!username) {
        // Note: visibility is fixed by deferReply above, so this posts publicly
        await interaction.editReply({
          content: '❌ Please provide a valid AniList username.',
        });
        return false;
      }

      try {
        const randomAnime = await this.fetchRandomAnime(username);

        const embed = this.createAnimeEmbed(randomAnime);

        await interaction.editReply({
          embeds: [embed],
        });
        return true;
      } catch (fetchError) {
        logger.error('Anime command processing error', {
          username,
          errorMessage: fetchError.message,
          errorStack: fetchError.stack,
        });

        // Guaranteed response to prevent "thinking" state
        await interaction.editReply({
          content: `❌ Error fetching anime for ${username}. Possible reasons:
        - Invalid AniList username
        - Empty anime list
        - AniList API temporarily unavailable
        - Network connectivity issues`,
        });
        return false;
      }
    } catch (globalError) {
      metricsService.trackError(globalError.name, 'anime_random');
      // Last-resort error handling
      logger.error('Critical error in anime command', {
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

module.exports = RandomAnimeService;
