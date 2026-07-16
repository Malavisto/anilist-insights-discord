const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const RandomAnimeService = require('../../modules/RandomAnimeService');

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
        'random_anime',
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
});
