const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const AnimeStatsService = require('../../modules/AnimeStatsService');

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

describe('AnimeStatsService', () => {
  let service;
  let mockAdapter;

  beforeEach(() => {
    service = new AnimeStatsService();
    mockAdapter = new MockAdapter(axios);
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAdapter.reset();
  });

  describe('fetchUserAnimeStats', () => {
    test('should fetch and calculate user anime statistics', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1, name: 'testuser' },
          MediaListCollection: {
            lists: [
              {
                name: 'Completed',
                entries: [
                  { status: 'COMPLETED', media: { averageScore: 85 } },
                  { status: 'COMPLETED', media: { averageScore: 90 } }
                ]
              },
              {
                name: 'Watching',
                entries: [
                  { status: 'CURRENT', media: { averageScore: 80 } }
                ]
              },
              {
                name: 'Paused',
                entries: []
              },
              {
                name: 'Dropped',
                entries: []
              },
              {
                name: 'Planning',
                entries: [
                  { status: 'PLANNING', media: { averageScore: 75 } }
                ]
              }
            ]
          }
        }
      });

      const stats = await service.fetchUserAnimeStats(username);

      expect(stats).toBeDefined();
      expect(stats.totalAnime).toBe(4);
      expect(stats.completedAnime).toBe(2);
      expect(stats.watchingAnime).toBe(1);
      expect(stats.planningAnime).toBe(1);
      expect(stats.pausedAnime).toBe(0);
      expect(stats.droppedAnime).toBe(0);
      expect(stats.averageScore).toBe('82.50'); // (85 + 90 + 80 + 75) / 4
    });

    test('should handle empty anime lists', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1, name: 'testuser' },
          MediaListCollection: {
            lists: [
              { name: 'Completed', entries: [] },
              { name: 'Watching', entries: [] },
              { name: 'Paused', entries: [] },
              { name: 'Dropped', entries: [] },
              { name: 'Planning', entries: [] }
            ]
          }
        }
      });

      const stats = await service.fetchUserAnimeStats(username);

      expect(stats.totalAnime).toBe(0);
      expect(stats.completedAnime).toBe(0);
      expect(stats.averageScore).toBe(0);
    });

    test('should handle missing average scores', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1, name: 'testuser' },
          MediaListCollection: {
            lists: [
              {
                name: 'Completed',
                entries: [
                  { status: 'COMPLETED', media: { averageScore: null } },
                  { status: 'COMPLETED', media: { averageScore: 80 } }
                ]
              },
              { name: 'Watching', entries: [] },
              { name: 'Paused', entries: [] },
              { name: 'Dropped', entries: [] },
              { name: 'Planning', entries: [] }
            ]
          }
        }
      });

      const stats = await service.fetchUserAnimeStats(username);

      expect(stats.totalAnime).toBe(2);
      expect(stats.averageScore).toBe('80.00'); // Only count the score 80
    });

    test('should use cached stats on second call', async () => {
      const username = 'testuser';
      const mockStats = {
        totalAnime: 10,
        completedAnime: 5,
        watchingAnime: 3,
        pausedAnime: 1,
        droppedAnime: 1,
        planningAnime: 0,
        averageScore: '82.50'
      };

      // First call
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1, name: 'testuser' },
          MediaListCollection: {
            lists: [
              {
                name: 'Completed',
                entries: Array(5).fill({ status: 'COMPLETED', media: { averageScore: 85 } })
              },
              {
                name: 'Watching',
                entries: Array(3).fill({ status: 'CURRENT', media: { averageScore: 80 } })
              },
              { name: 'Paused', entries: [{ status: 'PAUSED', media: { averageScore: 75 } }] },
              { name: 'Dropped', entries: [{ status: 'DROPPED', media: { averageScore: 60 } }] },
              { name: 'Planning', entries: [] }
            ]
          }
        }
      });

      const firstResult = await service.fetchUserAnimeStats(username);

      // Second call should use cache
      const secondResult = await service.fetchUserAnimeStats(username);

      expect(secondResult).toEqual(firstResult);
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

      await expect(service.fetchUserAnimeStats(username)).rejects.toThrow(
        'not found on AniList'
      );
    });

    test('should track API requests', async () => {
      const username = 'testuser';
      const metrics = require('../../metrics');

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: {
          User: { id: 1, name: 'testuser' },
          MediaListCollection: {
            lists: [
              { name: 'Completed', entries: [] },
              { name: 'Watching', entries: [] },
              { name: 'Paused', entries: [] },
              { name: 'Dropped', entries: [] },
              { name: 'Planning', entries: [] }
            ]
          }
        }
      });

      try {
        await service.fetchUserAnimeStats(username);
      } catch (e) {
        // Ignore
      }

      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'anime_stats',
        'started',
        username
      );
    });
  });

  describe('createAnimeStatsEmbed', () => {
    test('should create Discord embed with stats', () => {
      const username = 'testuser';
      const stats = {
        totalAnime: 10,
        completedAnime: 5,
        watchingAnime: 3,
        pausedAnime: 1,
        droppedAnime: 1,
        planningAnime: 0,
        averageScore: '82.50'
      };

      const embed = service.createAnimeStatsEmbed(username, stats);

      expect(embed).toBeDefined();
      expect(embed.data.title).toContain(username);
      expect(embed.data.fields).toBeDefined();
      expect(embed.data.fields.length).toBeGreaterThan(0);
    });

    test('should include all required fields in embed', () => {
      const username = 'testuser';
      const stats = {
        totalAnime: 10,
        completedAnime: 5,
        watchingAnime: 3,
        pausedAnime: 1,
        droppedAnime: 1,
        planningAnime: 0,
        averageScore: '82.50'
      };

      const embed = service.createAnimeStatsEmbed(username, stats);
      const fieldNames = embed.data.fields.map(f => f.name);

      expect(fieldNames).toContainEqual(expect.stringMatching(/Total Anime/i));
      expect(fieldNames).toContainEqual(expect.stringMatching(/Completed/i));
      expect(fieldNames).toContainEqual(expect.stringMatching(/Watching/i));
      expect(fieldNames).toContainEqual(expect.stringMatching(/Average Score/i));
    });
  });

  describe('error handling', () => {
    test('should handle network errors', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await expect(service.fetchUserAnimeStats(username)).rejects.toThrow();
    });

    test('should track errors', async () => {
      const username = 'testuser';
      const metrics = require('../../metrics');

      mockAdapter.onPost('https://graphql.anilist.co').reply(500, {
        errors: [{ message: 'Server error' }]
      });

      try {
        await service.fetchUserAnimeStats(username);
      } catch (e) {
        // Expected
      }

      expect(metrics.trackError).toHaveBeenCalled();
    });
  });
});
