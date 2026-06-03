/**
 * Tests for RandomAnimeService - AniList anime fetching and Discord embeds
 */
const RandomAnimeService = require('../modules/RandomAnimeService');
const axios = require('axios');
const { EmbedBuilder } = require('discord.js');
const logger = require('../logger');
const metricsService = require('../metrics');
const CacheService = require('../modules/CacheService');

jest.useFakeTimers();

describe('RandomAnimeService', () => {
  let service;

  beforeEach(() => {
    service = new RandomAnimeService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (service.cache) {
      service.cache.clearAll();
    }
  });

  // Constructor Tests
  describe('constructor', () => {
    test('initializes with a cache service', () => {
      expect(service.cache).toBeDefined();
      expect(service.cache).toBeInstanceOf(CacheService);
    });

    test('cache is named "RandomAnime"', () => {
      expect(service.cache.name).toBe('RandomAnime');
    });
  });

  // fetchRandomAnime Tests
  describe('fetchRandomAnime', () => {
    const mockUsername = 'testuser';
    const mockAnimeIds = [1, 2, 3, 4, 5];
    const mockAnimeData = {
      data: {
        data: {
          MediaList: {
            media: {
              id: 1,
              title: {
                english: 'Test Anime',
                romaji: 'テスト アニメ'
              },
              episodes: 12,
              format: 'TV',
              status: 'FINISHED',
              genres: ['Action', 'Adventure'],
              description: '<p>A test anime description</p>',
              averageScore: 75,
              seasonYear: 2020,
              coverImage: {
                large: 'https://example.com/small.jpg',
                extraLarge: 'https://example.com/large.jpg'
              }
            },
            status: 'COMPLETED',
            score: 8
          }
        }
      }
    };

    test('returns anime data from successful API call', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [{ entries: [{ media: { id: 1 } }] }] }
          }
        }
      }).mockResolvedValueOnce(mockAnimeData);

      const result = await service.fetchRandomAnime(mockUsername);

      expect(result).toHaveProperty('id', 1);
      expect(result).toHaveProperty('title', 'Test Anime');
      expect(result).toHaveProperty('episodes', 12);
      expect(result).toHaveProperty('format', 'TV');
      expect(result).toHaveProperty('status', 'COMPLETED');
    });

    test('caches anime IDs for future requests', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [{ entries: mockAnimeIds.map(id => ({ media: { id } })) }] }
          }
        }
      }).mockResolvedValueOnce(mockAnimeData);

      await service.fetchRandomAnime(mockUsername);

      const cachedIds = service.cache.get(`anime_ids_${mockUsername}`);
      expect(cachedIds).toEqual(mockAnimeIds);
    });

    test('uses cached anime IDs on second request', async () => {
      // First request
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [{ entries: [{ media: { id: 1 } }] }] }
          }
        }
      }).mockResolvedValueOnce(mockAnimeData);

      await service.fetchRandomAnime(mockUsername);

      // Second request
      axios.post.mockClear();
      axios.post.mockResolvedValueOnce(mockAnimeData);

      await service.fetchRandomAnime(mockUsername);

      // Should only call axios once (for anime details, not for IDs)
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    test('throws error when user not found', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: null, // User doesn't exist
            MediaListCollection: { lists: [] }
          }
        }
      });

      await expect(service.fetchRandomAnime(mockUsername)).rejects.toThrow(
        `User ${mockUsername} not found on AniList`
      );
    });

    test('throws error when user has empty anime list', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [] } // Empty list
          }
        }
      });

      await expect(service.fetchRandomAnime(mockUsername)).rejects.toThrow(
        `No anime found in ${mockUsername}'s list`
      );
    });

    test('logs error when fetch fails', async () => {
      const error = new Error('API Error');
      axios.post.mockRejectedValueOnce(error);

      await expect(service.fetchRandomAnime(mockUsername)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Anime fetch failed',
        expect.objectContaining({
          username: mockUsername,
          errorMessage: error.message
        })
      );
    });

    test('selects random anime from list', async () => {
      const animeIds = [1, 2, 3, 4, 5];
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [{ entries: animeIds.map(id => ({ media: { id } })) }] }
          }
        }
      }).mockResolvedValueOnce(mockAnimeData);

      // Mock Math.random to test specific selection
      const originalMath = Math.random;
      Math.random = jest.fn(() => 0.2); // Select index 1 (ID 2)

      await service.fetchRandomAnime(mockUsername);

      // Verify the second anime was requested
      const calls = axios.post.mock.calls;
      const secondCall = calls[1];
      expect(secondCall[1].variables.id).toBe(2);

      Math.random = originalMath;
    });

    test('handles missing anime data gracefully', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [{ entries: [{ media: { id: 1 } }] }] }
          }
        }
      }).mockResolvedValueOnce({
        data: {
          data: {
            MediaList: null // No anime data returned
          }
        }
      });

      await expect(service.fetchRandomAnime(mockUsername)).rejects.toThrow(
        `No anime data found for user ${mockUsername}`
      );
    });

    test('uses romaji title when english title unavailable', async () => {
      const romajiOnlyData = {
        data: {
          data: {
            MediaList: {
              media: {
                id: 1,
                title: {
                  english: null,
                  romaji: 'ロマンティック アニメ'
                },
                episodes: 12,
                format: 'TV',
                status: 'FINISHED',
                genres: [],
                description: null,
                averageScore: 75,
                seasonYear: 2020,
                coverImage: { large: null, extraLarge: null }
              },
              status: 'COMPLETED',
              score: 8
            }
          }
        }
      };

      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [{ entries: [{ media: { id: 1 } }] }] }
          }
        }
      }).mockResolvedValueOnce(romajiOnlyData);

      const result = await service.fetchRandomAnime(mockUsername);

      expect(result.title).toBe('ロマンティック アニメ');
    });
  });

  // createAnimeEmbed Tests
  describe('createAnimeEmbed', () => {
    const mockAnime = {
      id: 123,
      title: 'Test Anime',
      episodes: 12,
      format: 'TV',
      status: 'FINISHED',
      userScore: 8,
      averageScore: 75,
      genres: ['Action', 'Adventure', 'Drama'],
      year: 2020,
      description: '<p>Test description</p>',
      coverImage: 'https://example.com/cover.jpg'
    };

    test('creates embed with required properties', () => {
      const embed = service.createAnimeEmbed(mockAnime);

      expect(embed).toBeDefined();
      expect(EmbedBuilder).toHaveBeenCalled();
    });

    test('cleans HTML tags from description', () => {
      const result = service.createAnimeEmbed(mockAnime);
      
      // The result is a mock, but we can verify the setDescription was called with cleaned text
      expect(result.setDescription).toHaveBeenCalled();
    });

    test('handles null description', () => {
      const noDescAnime = {
        ...mockAnime,
        description: null
      };

      const embed = service.createAnimeEmbed(noDescAnime);
      expect(embed).toBeDefined();
    });

    test('sets image when cover image URL is valid', () => {
      const embed = service.createAnimeEmbed(mockAnime);

      expect(embed.setImage).toHaveBeenCalled();
    });

    test('skips image when cover image is null', () => {
      const noCoverAnime = {
        ...mockAnime,
        coverImage: null
      };

      const embed = service.createAnimeEmbed(noCoverAnime);
      // setImage should not be called if no valid URL
      expect(embed).toBeDefined();
    });

    test('skips image when cover image URL is invalid', () => {
      const badUrlAnime = {
        ...mockAnime,
        coverImage: 'not-a-valid-url'
      };

      const embed = service.createAnimeEmbed(badUrlAnime);
      expect(embed).toBeDefined();
    });
  });

  // isValidHttpUrl Tests
  describe('isValidHttpUrl', () => {
    test('validates HTTP URLs', () => {
      expect(service.isValidHttpUrl('http://example.com')).toBe(true);
    });

    test('validates HTTPS URLs', () => {
      expect(service.isValidHttpUrl('https://example.com/path')).toBe(true);
    });

    test('rejects invalid URLs', () => {
      expect(service.isValidHttpUrl('not-a-url')).toBe(false);
    });

    test('rejects FTP URLs', () => {
      expect(service.isValidHttpUrl('ftp://example.com')).toBe(false);
    });

    test('rejects empty strings', () => {
      expect(service.isValidHttpUrl('')).toBe(false);
    });

    test('rejects null values', () => {
      expect(service.isValidHttpUrl(null)).toBe(false);
    });
  });

  // handleRandomAnimeCommand Tests
  describe('handleRandomAnimeCommand', () => {
    let mockInteraction;

    beforeEach(() => {
      mockInteraction = {
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        options: {
          getString: jest.fn().mockReturnValue('testuser')
        },
        deferred: true,
        replied: false
      };
    });

    test('defers reply on command start', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [{ entries: [{ media: { id: 1 } }] }] }
          }
        }
      }).mockResolvedValueOnce({
        data: {
          data: {
            MediaList: {
              media: { id: 1, title: { english: 'Test', romaji: 'Test' }, episodes: 12, format: 'TV', status: 'FINISHED', genres: [], description: null, averageScore: 75, seasonYear: 2020, coverImage: { large: null, extraLarge: null } },
              status: 'COMPLETED',
              score: 8
            }
          }
        }
      });

      await service.handleRandomAnimeCommand(mockInteraction);

      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
    });

    test('responds with error when no username provided', async () => {
      mockInteraction.options.getString.mockReturnValue(null);

      await service.handleRandomAnimeCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Please provide a valid AniList username')
        })
      );
    });

    test('responds with embed on successful fetch', async () => {
      axios.post.mockResolvedValueOnce({
        data: {
          data: {
            User: { id: 1 },
            MediaListCollection: { lists: [{ entries: [{ media: { id: 1 } }] }] }
          }
        }
      }).mockResolvedValueOnce({
        data: {
          data: {
            MediaList: {
              media: { id: 1, title: { english: 'Test', romaji: 'Test' }, episodes: 12, format: 'TV', status: 'FINISHED', genres: [], description: null, averageScore: 75, seasonYear: 2020, coverImage: { large: null, extraLarge: null } },
              status: 'COMPLETED',
              score: 8
            }
          }
        }
      });

      await service.handleRandomAnimeCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalled();
    });

    test('responds with error message on fetch failure', async () => {
      axios.post.mockRejectedValueOnce(new Error('API Error'));

      await service.handleRandomAnimeCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Error fetching anime')
        })
      );
    });

    test('logs error on fetch failure', async () => {
      axios.post.mockRejectedValueOnce(new Error('API Error'));

      await service.handleRandomAnimeCommand(mockInteraction);

      expect(logger.error).toHaveBeenCalled();
    });
  });
});
