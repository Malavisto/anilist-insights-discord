const axios = require('axios');
const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const logger = require('../logger');
const metricsService = require('../metrics');
const CacheService = require('./CacheService');

// Main Logic
class RandomMangaService {   
    constructor() {
        this.cache = new CacheService(300000, 'RandomManga');
    }

    // /mangarandom slash-command
    static get commandDefinition() {
        return {
            builder: new SlashCommandBuilder()
                .setName('mangarandom')
                .setDescription('Get a random manga from a user\'s AniList')
                .addStringOption(option =>
                    option.setName('username')
                        .setDescription('AniList username to fetch manga from')
                        .setRequired(true)
                ),
            methodName: 'handleRandomMangaCommand',
            metricName: 'manga_random'
        };
    }

    async fetchRandomManga(username) {
        try {
            metricsService.trackApiRequest('manga_random', 'started', username);

            const query_ids = `
            query ($username: String) {
                User(name: $username) {
                    id  # Validate user exists first
                }
                MediaListCollection(userName: $username, type: MANGA) {
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

            const query_manga = `
            query ($username: String, $id: Int) {
                MediaList(userName: $username, mediaId: $id) {
                            media {
                                id
                                title {
                                    english
                                    romaji
                                }
                                chapters
                                volumes
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

            // Check if manga IDs are cached
            const cacheKey = `manga_ids_${username}`;
            let allIDs = this.cache.get(cacheKey);

            if (allIDs) {
                metricsService.trackCacheHit('manga_random');
                metricsService.trackApiRequest('manga_random', 'cache_hit', username);
            } else {
                const response_ids = await axios.post('https://graphql.anilist.co',
                    {
                        query: query_ids,
                        variables: { username }
                    },
                    {
                        signal: AbortSignal.timeout(10000),
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        }
                    }
                );

                if (!response_ids.data.data.User) {
                    throw new Error(`User ${username} not found on AniList`);
                }

                allIDs = response_ids.data.data.MediaListCollection.lists
                    .flatMap(list => list.entries.map(entry => entry.media.id));

                // Cache the IDs for future requests
                this.cache.set(cacheKey, allIDs);
            }

            if (allIDs.length === 0) {
                throw new Error(`No manga found in ${username}'s list`);
            }

            const randomID = allIDs[Math.floor(Math.random() * allIDs.length)];

            const id = randomID;

            const response_manga = await axios.post('https://graphql.anilist.co',
                {
                    query: query_manga,
                    variables: { username, id }
                },
                {
                    signal: AbortSignal.timeout(10000),
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    }
                }
            );
            if (!response_manga.data.data.MediaList) {
                throw new Error(`No manga data found for user ${username}`);
            }
            metricsService.trackApiRequest('manga_random', 'success', username);

            const randomManga = response_manga.data.data.MediaList;

            return {
                id: randomManga.media.id,
                title: randomManga.media.title.english || randomManga.media.title.romaji,
                chapters: randomManga.media.chapters || 'Unknown',
                volumes: randomManga.media.volumes || 'Unknown',
                format: randomManga.media.format,
                status: randomManga.status,
                userScore: randomManga.score,
                averageScore: randomManga.media.averageScore,
                genres: randomManga.media.genres,
                year: randomManga.media.seasonYear,
                description: randomManga.media.description,
                coverImage: randomManga.media.coverImage.extraLarge ||
                    randomManga.media.coverImage.large ||
                    null
            };
        } catch (error) {
            logger.error('Manga fetch failed', {
                username,
                errorMessage: error.message,
                errorStack: error.stack
            });
            throw error;
        }
    }

    createMangaEmbed(manga) {
        // Clean up description 
        const cleanDescription = manga.description
            ? manga.description
                .replace(/<\/?[^>]+(>|$)/g, '')
                .replace(/\s+/g, ' ')
                .trim()
            : 'No description available';

        // Direct link to the specific manga page using its ID
        const mangaDirectLink = `https://anilist.co/manga/${manga.id}`;

        // Emoji mapping for different statuses and formats
        const statusEmojis = {
            'COMPLETED': '✅',
            'CURRENT': '📰',
            'NOT_YET_RELEASED': '⏳',
            'CANCELLED': '❌',
            "PAUSED": '⏸️'
        };

        const formatEmojis = {
            'TV': '📺',
            'MOVIE': '🎬',
            'OVA': '💿',
            'SPECIAL': '⭐',
            'MUSIC': '🎵',
            'ONA': '💻',
            'MANGA': '📖',
            'NOVEL': '📓'
        };

        const embedBuilder = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle(`🌟 ${manga.title}`)
            .setURL(mangaDirectLink)
            .setDescription(
                `📝 ${cleanDescription.length > 200
                    ? cleanDescription.substring(0, 200) + '...'
                    : cleanDescription}`
            )
            .addFields(
                {
                    name: '📡 Status',
                    value: `${statusEmojis[manga.status] || '❓'} ${manga.status}`,
                    inline: true
                },
                {
                    name: '📕 Volumes',
                    value: `🔢 ${manga.volumes.toString()}` || 'Unknown',
                    inline: true
                },
                {
                    name: '📄 Chapters',
                    value: `🔢 ${manga.chapters.toString()}` || 'Unknown',
                    inline: true
                },
                {
                    name: '🎭 Format',
                    value: `${formatEmojis[manga.format] || '🎴'} ${manga.format}`,
                    inline: true
                },
                {
                    name: '📅 Year',
                    value: `🗓️ ${manga.year?.toString() || 'Unknown'}`,
                    inline: true
                },
                {
                    name: '🏷️ Genres',
                    value: manga.genres.length > 0
                        ? manga.genres.map(genre => `#${genre}`).join(' ')
                        : 'No genres',
                    inline: false
                },
                {
                    name: '⭐ Your Score',
                    value: `📊 ${manga.userScore?.toString() || 'Not rated'}`,
                    inline: true
                },
                {
                    name: '📈 Average Score',
                    value: `🌈 ${manga.averageScore || 'N/A'}%`,
                    inline: true
                }
            )
            .setFooter({
                text: '🔗 Click title to view on AniList'
            });

        // Add thumbnail only if a valid image URL exists
        if (manga.coverImage && this.isValidHttpUrl(manga.coverImage)) {
            embedBuilder.setImage(manga.coverImage);
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

    async handleRandomMangaCommand(interaction) {
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
                    content: "❌ Please provide a valid AniList username."
                });
                return;
            }

            try {
                const randomManga = await this.fetchRandomManga(username);

                const embed = this.createMangaEmbed(randomManga);

                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: false
                });

            } catch (fetchError) {
                logger.error('Manga command processing error', {
                    username,
                    errorMessage: fetchError.message,
                    errorStack: fetchError.stack
                });

                // Guaranteed response to prevent "thinking" state
                await interaction.editReply({
                    content: `❌ Error fetching manga for ${username}. Possible reasons:
        - Invalid AniList username
        - Empty manga list
        - AniList API temporarily unavailable
        - Network connectivity issues`
                });
            }


        } catch (globalError) {
            // Last-resort error handling
            logger.error('Critical error in manga command', {
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
                metricsService.trackError(globalError.name || 'unknown_error', 'manga_random');
                metricsService.trackApiRequest('manga_random', 'failure', username);
                logger.error('Failed to send final error message', {
                    originalError: globalError,
                    replyError
                });
            }
        }

    }
}


module.exports = RandomMangaService;

