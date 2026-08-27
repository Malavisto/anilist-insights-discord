const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const RandomAnimeService = require('../../modules/RandomAnimeService');
const { createMockInteraction } = require('../helpers/mockInteraction');

jest.mock('../../logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../metrics', () => ({
  trackApiRequest: jest.fn(),
  trackCacheHit: jest.fn(),
  trackError: jest.fn(),
  trackCommand: jest.fn(() => jest.fn())
}));

describe('RandomAnimeService', () => {
  let service;
  let mockAdapter;

  beforeEach(() => {
    service = new RandomAnimeService();
    mockAdapter = new MockAdapter(axios);
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAdapter.reset();
  });

  describe('fetchRandomAnime', () => {
    test('should return a random anime from user list', async () => {
      const username = 'testuser';
      const mockAnimeIds = [1, 5, 10, 15];
      const mockAnimeId = 5;

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [
              {
                entries: mockAnimeIds.map(id => ({ media: { id } }))
              }
            ]
          }
        }
      });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaList: {
            media: {
              id: mockAnimeId,
              title: {
                english: 'Test Anime',
                romaji: 'テスト アニメ'
              },
              episodes: 12,
              format: 'TV',
              status: 'FINISHED',
              genres: ['Action', 'Adventure'],
              description: 'A test anime',
              averageScore: 85,
              seasonYear: 2024,
              coverImage: {
                large: 'https://example.com/cover.jpg',
                extraLarge: 'https://example.com/cover_large.jpg'
              }
            },
            status: 'COMPLETED',
            score: 9
          }
        }
      });

      const result = await service.fetchRandomAnime(username);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockAnimeId);
      expect(result.title).toBeDefined();
      expect(result.episodes).toBe(12);
    });

    test('should use cached anime IDs on second call', async () => {
      const username = 'testuser';
      const mockAnimeIds = [1, 5, 10];

      // First call - populate cache
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [
              {
                entries: mockAnimeIds.map(id => ({ media: { id } }))
              }
            ]
          }
        }
      });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaList: {
            media: {
              id: 5,
              title: { english: 'Test Anime', romaji: 'テスト' },
              episodes: 12,
              format: 'TV',
              status: 'FINISHED',
              genres: [],
              description: '',
              averageScore: 80,
              seasonYear: 2024,
              coverImage: { large: 'url', extraLarge: 'url' }
            },
            status: 'COMPLETED',
            score: 9
          }
        }
      });

      await service.fetchRandomAnime(username);

      // Second call should use cache
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaList: {
            media: {
              id: 10,
              title: { english: 'Test Anime 2', romaji: 'テスト2' },
              episodes: 13,
              format: 'TV',
              status: 'FINISHED',
              genres: [],
              description: '',
              averageScore: 75,
              seasonYear: 2024,
              coverImage: { large: 'url', extraLarge: 'url' }
            },
            status: 'COMPLETED',
            score: 8
          }
        }
      });

      const result = await service.fetchRandomAnime(username);
      expect(result).toBeDefined();

      // Cache hit should be tracked
      const metrics = require('../../metrics');
      expect(metrics.trackCacheHit).toHaveBeenCalled();
    });

    test('should throw error if user not found', async () => {
      const username = 'nonexistentuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: null,
          MediaListCollection: { lists: [] }
        }
      });

      await expect(service.fetchRandomAnime(username)).rejects.toThrow(
        'not found on AniList'
      );
    });

    test('should throw error if user has no anime', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: []
          }
        }
      });

      await expect(service.fetchRandomAnime(username)).rejects.toThrow(
        'No anime found'
      );
    });

    test('should track API requests', async () => {
      const username = 'testuser';
      const metrics = require('../../metrics');

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [
              {
                entries: [{ media: { id: 1 } }]
              }
            ]
          }
        }
      });

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: {
          MediaList: {
            media: {
              id: 1,
              title: { english: 'Test', romaji: 'テスト' },
              episodes: 12,
              format: 'TV',
              status: 'FINISHED',
              genres: [],
              description: '',
              averageScore: 80,
              seasonYear: 2024,
              coverImage: { large: 'url', extraLarge: 'url' }
            },
            status: 'COMPLETED',
            score: 9
          }
        }
      });

      try {
        await service.fetchRandomAnime(username);
      } catch (e) {
        // Ignore
      }

      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'anime_random',
        'started',
        username
      );
    });
  });

  describe('error handling', () => {
    test('should handle network errors gracefully', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await expect(service.fetchRandomAnime(username)).rejects.toThrow();
    });

    test('should handle malformed API response', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: undefined
      });

      await expect(service.fetchRandomAnime(username)).rejects.toThrow();
    });
  });

  describe('handleRandomAnimeCommand', () => {
    const mockIdsResponse = {
      data: {
        User: { id: 1 },
        MediaListCollection: {
          lists: [{ entries: [{ media: { id: 5 } }] }]
        }
      }
    };

    const mockAnimeResponse = {
      data: {
        MediaList: {
          media: {
            id: 5,
            title: { english: 'Test Anime', romaji: 'テスト アニメ' },
            episodes: 12,
            format: 'TV',
            status: 'FINISHED',
            genres: ['Action'],
            description: 'A test anime',
            averageScore: 85,
            seasonYear: 2024,
            coverImage: {
              large: 'https://example.com/cover.jpg',
              extraLarge: 'https://example.com/cover_large.jpg'
            }
          },
          status: 'COMPLETED',
          score: 9
        }
      }
    };

    test('should defer then edit the reply with the anime embed on success', async () => {
      const interaction = createMockInteraction();

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, mockIdsResponse);
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, mockAnimeResponse);

      await service.handleRandomAnimeCommand(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      expect(interaction.editReply).toHaveBeenCalledTimes(1);
      const embed = interaction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('🌟 Test Anime');
    });

    test('should ask for a username when the option is missing', async () => {
      const interaction = createMockInteraction({
        options: { getString: jest.fn().mockReturnValue(undefined) }
      });

      await service.handleRandomAnimeCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ Please provide a valid AniList username.'
      });
      expect(mockAdapter.history.post.length).toBe(0);
    });

    test('should edit the reply with a friendly error when fetching fails', async () => {
      const interaction = createMockInteraction();
      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await service.handleRandomAnimeCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('❌ Error fetching anime for testuser')
      });
    });

    test('should fall back to reply() when deferReply itself fails', async () => {
      const interaction = createMockInteraction({
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction'))
      });

      await service.handleRandomAnimeCommand(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('An unexpected error occurred'),
          ephemeral: true
        })
      );
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    test('should fall back to an ephemeral editReply when the friendly error send fails', async () => {
      const interaction = createMockInteraction({
        editReply: jest.fn()
          .mockRejectedValueOnce(new Error('cannot edit'))
          .mockResolvedValueOnce(undefined)
      });
      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await service.handleRandomAnimeCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledTimes(2);
      expect(interaction.editReply).toHaveBeenLastCalledWith({
        content: '❌ An unexpected error occurred. Please try again later.',
        ephemeral: true
      });
    });
  });

  describe('createAnimeEmbed', () => {
    const baseAnime = {
      id: 5,
      title: 'Test Anime',
      episodes: 12,
      format: 'TV',
      status: 'FINISHED',
      genres: ['Action', 'Adventure'],
      year: 2024,
      description: 'A test anime',
      userScore: 9,
      averageScore: 85,
      coverImage: 'https://example.com/cover_large.jpg'
    };

    test('should strip HTML tags and collapse whitespace in descriptions', () => {
      const embed = service.createAnimeEmbed({
        ...baseAnime,
        description: '<p>Hello world</p>\n\n  second part'
      });

      expect(embed.data.description).toBe('📝 Hello world second part');
    });

    test('should truncate descriptions over 200 characters with an ellipsis', () => {
      const embed = service.createAnimeEmbed({
        ...baseAnime,
        description: 'a'.repeat(300)
      });

      expect(embed.data.description).toBe(`📝 ${'a'.repeat(200)}...`);
    });

    test('should use a default description when none is provided', () => {
      const embed = service.createAnimeEmbed({ ...baseAnime, description: '' });

      expect(embed.data.description).toBe('📝 No description available');
    });

    test('should map known status and format values to emojis', () => {
      const embed = service.createAnimeEmbed(baseAnime);

      expect(embed.data.fields.find(f => f.name === '📡 Status').value).toBe('✅ FINISHED');
      expect(embed.data.fields.find(f => f.name === '🎭 Format').value).toBe('📺 TV');
    });

    test('should use fallback emojis for unknown status and format', () => {
      const embed = service.createAnimeEmbed({
        ...baseAnime,
        status: 'HIATUS',
        format: 'UNKNOWN'
      });

      expect(embed.data.fields.find(f => f.name === '📡 Status').value).toBe('❓ HIATUS');
      expect(embed.data.fields.find(f => f.name === '🎭 Format').value).toBe('🎴 UNKNOWN');
    });

    test('should build title, link and color from the anime', () => {
      const embed = service.createAnimeEmbed(baseAnime);

      expect(embed.data.title).toBe('🌟 Test Anime');
      expect(embed.data.url).toBe('https://anilist.co/anime/5');
      expect(embed.data.color).toBe(0x0099ff);
    });

    test('should render genre hashtags and the empty-list fallback', () => {
      const embed = service.createAnimeEmbed(baseAnime);
      expect(embed.data.fields.find(f => f.name === '🏷️ Genres').value).toBe('#Action #Adventure');

      const emptyGenres = service.createAnimeEmbed({ ...baseAnime, genres: [] });
      expect(emptyGenres.data.fields.find(f => f.name === '🏷️ Genres').value).toBe('No genres');
    });

    test('should use fallbacks for missing episodes, year, scores and zero averageScore', () => {
      const embed = service.createAnimeEmbed({
        ...baseAnime,
        episodes: 'Unknown',
        year: null,
        userScore: null,
        averageScore: 0
      });

      expect(embed.data.fields.find(f => f.name === '🎞️ Episodes').value).toBe('🔢 Unknown');
      expect(embed.data.fields.find(f => f.name === '📅 Year').value).toBe('🗓️ Unknown');
      expect(embed.data.fields.find(f => f.name === '⭐ Your Score').value).toBe('📊 Not rated');
      expect(embed.data.fields.find(f => f.name === '📈 Average Score').value).toBe('🌈 N/A%');
    });

    test('should set the cover image for a valid https URL', () => {
      const embed = service.createAnimeEmbed(baseAnime);

      expect(embed.data.image.url).toBe('https://example.com/cover_large.jpg');
    });

    test('should omit the image for non-http URLs', () => {
      const ftp = service.createAnimeEmbed({ ...baseAnime, coverImage: 'ftp://example.com/cover.jpg' });
      const garbage = service.createAnimeEmbed({ ...baseAnime, coverImage: 'not-a-url' });

      expect(ftp.data.image).toBeUndefined();
      expect(garbage.data.image).toBeUndefined();
    });
  });

  describe('isValidHttpUrl', () => {
    test('should accept https and http URLs', () => {
      expect(service.isValidHttpUrl('https://example.com/a.jpg')).toBe(true);
      expect(service.isValidHttpUrl('http://example.com')).toBe(true);
    });

    test('should reject other schemes and malformed strings', () => {
      expect(service.isValidHttpUrl('ftp://example.com/file')).toBe(false);
      expect(service.isValidHttpUrl('not a url')).toBe(false);
    });
  });
});
