const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const logger = require('../logger');
const metricsService = require('../metrics');
const CacheService = require('./CacheService');

// Main Logic
class RandomAnimeService {
    constructor() {
        this.cache = new CacheService();
    }


    async fetchRandomAnime(username) {
        try {
            metricsService.trackApiRequest('random_anime', 'started', username);

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

            const response_ids = await axios.post('https://graphql.anilist.co',
                {
                    query: query_ids,
                    variables: { username }
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );

            const allIDs = response_ids.data.data.MediaListCollection.lists
                .flatMap(list => list.entries.map(entry => entry.media.id));

            if (allIDs.length === 0) {
                throw new Error(`No anime found in ${username}'s list`);
            }

            const randomID = allIDs[Math.floor(Math.random() * allIDs.length)];

            const id = randomID;

            const response_anime = await axios.post('https://graphql.anilist.co',
                {
                    query: query_anime,
                    variables: { username, id }
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );
            metricsService.trackApiRequest('random_anime', 'success', username);

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
                coverImage: randomAnime.media.coverImage.extraLarge ||
                    randomAnime.media.coverImage.large ||
                    null
            };
        } catch (error) {
            logger.error('Anime fetch failed', {
                username,
                errorMessage: error.message,
                errorStack: error.stack
            });
            throw error;
        }
    }

    createAnimeEmbed(anime) {
        // Clean up description 
        const cleanDescription = anime.description
            ? anime.description
                .replace(/<\/?[^>]+(>|$)/g, '')
                .replace(/\s+/g, ' ')
                .trim()
            : 'No description available';

        // Direct link to the specific anime page using its ID
        const animeDirectLink = `https://anilist.co/anime/${anime.id}`;

        // Emoji mapping for different statuses and formats
        const statusEmojis = {
            'FINISHED': '✅',
            'RELEASING': '🔴',
            'NOT_YET_RELEASED': '⏳',
            'CANCELLED': '❌'
        };

        const formatEmojis = {
            'TV': '📺',
            'MOVIE': '🎬',
            'OVA': '💿',
            'SPECIAL': '⭐',
            'MUSIC': '🎵',
            'ONA': '💻',
            'MANGA': '📖'
        };

        const embedBuilder = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`🌟 ${anime.title}`)
            .setURL(animeDirectLink)
            .setDescription(
                `📝 ${cleanDescription.length > 200
                    ? cleanDescription.substring(0, 200) + '...'
                    : cleanDescription}`
            )
            .addFields(
                {
                    name: '📡 Status',
                    value: `${statusEmojis[anime.status] || '❓'} ${anime.status}`,
                    inline: true
                },
                {
                    name: '🎞️ Episodes',
                    value: `🔢 ${anime.episodes.toString()}`,
                    inline: true
                },
                {
                    name: '🎭 Format',
                    value: `${formatEmojis[anime.format] || '🎴'} ${anime.format}`,
                    inline: true
                },
                {
                    name: '📅 Year',
                    value: `🗓️ ${anime.year?.toString() || 'Unknown'}`,
                    inline: true
                },
                {
                    name: '🏷️ Genres',
                    value: anime.genres.length > 0
                        ? anime.genres.map(genre => `#${genre}`).join(' ')
                        : 'No genres',
                    inline: false
                },
                {
                    name: '⭐ Your Score',
                    value: `📊 ${anime.userScore?.toString() || 'Not rated'}`,
                    inline: true
                },
                {
                    name: '📈 Average Score',
                    value: `🌈 ${anime.averageScore || 'N/A'}%`,
                    inline: true
                }
            )
            .setFooter({
                text: '🔗 Click title to view on AniList'
            });

        // Add thumbnail only if a valid image URL exists
        if (anime.coverImage && this.isValidHttpUrl(anime.coverImage)) {
            embedBuilder.setImage(anime.coverImage);
        }

        return embedBuilder;
    }

    isValidHttpUrl(string) {
        try {
            const url = new URL(string);
            return url.protocol === "http:" || url.protocol === "https:";
        } catch (_) {
            return false;
        }
    }

    async handleRandomAnimeCommand(interaction) {
        try {
            // Immediately defer the reply to prevent timeout
            await interaction.deferReply({ ephemeral: false });

            const username = interaction.options.getString('username');

            // Early validation with quick response
            if (!username) {
                await interaction.editReply({
                    content: "❌ Please provide a valid AniList username.",
                    ephemeral: true
                });
                return;
            }

            try {
                const randomAnime = await this.fetchRandomAnime(username);

                const embed = this.createAnimeEmbed(randomAnime);

                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: false
                });

            } catch (fetchError) {
                logger.error('Anime command processing error', {
                    username,
                    errorMessage: fetchError.message,
                    errorStack: fetchError.stack
                });

                // Guaranteed response to prevent "thinking" state
                await interaction.editReply({
                    content: `❌ Error fetching anime for ${username}. Possible reasons:
        - Invalid AniList username
        - Empty anime list
        - AniList API temporarily unavailable
        - Network connectivity issues`,
                    ephemeral: true
                });
            }


        } catch (globalError) {
            // Last-resort error handling
            logger.error('Critical error in anime command', {
                errorMessage: globalError.message,
                errorStack: globalError.stack
            });


            try {
                // Final attempt to respond to interaction
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({
                        content: "❌ An unexpected error occurred. Please try again later.",
                        ephemeral: true
                    });
                } else if (interaction.deferred) {
                    await interaction.editReply({
                        content: "❌ An unexpected error occurred. Please try again later.",
                        ephemeral: true
                    });

                }


            }
            catch (replyError) {
                // If all else fails, log the error
                metricsService.trackError(globalError.name || 'unknown_error', 'random_anime');
                metricsService.trackApiRequest('random_anime', 'failure', username);
                logger.error('Failed to send final error message', {
                    originalError: globalError,
                    replyError
                });
            }
        }

    }
}


module.exports = RandomAnimeService;


//        finally {
//      if (endTimer) {
//          endTimer(error ? 'failure' : 'success');
//      }
//  }
//

// The above is for future me to impliment
