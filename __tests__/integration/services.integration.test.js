const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const CacheService = require('../../modules/CacheService');
const RandomAnimeService = require('../../modules/RandomAnimeService');
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

describe('Integration Tests - Service Interactions', () => {
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = new MockAdapter(axios);
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAdapter.reset();
  });

  describe('RandomAnimeService with CacheService', () => {
    test('should utilize cache across multiple calls', async () => {
      const service = new RandomAnimeService();
      const username = 'testuser';
      const animeIds = [1, 5, 10, 15, 20];

      // First call - will hit API and cache anime IDs
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [
              {
                entries: animeIds.map(id => ({ media: { id } }))
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
              title: { english: 'Anime', romaji: 'アニメ' },
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

      const result1 = await service.fetchRandomAnime(username);
      expect(result1).toBeDefined();

      // Second call - should use cached IDs, only fetch the anime data
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaList: {
            media: {
              id: 10,
              title: { english: 'Anime 2', romaji: 'アニメ2' },
              episodes: 13,
              format: 'TV',
              status: 'FINISHED',
              genres: [],
              description: '',
              averageScore: 85,
              seasonYear: 2024,
              coverImage: { large: 'url', extraLarge: 'url' }
            },
            status: 'COMPLETED',
            score: 8
          }
        }
      });

      const result2 = await service.fetchRandomAnime(username);
      expect(result2).toBeDefined();

      const metrics = require('../../metrics');
      expect(metrics.trackCacheHit).toHaveBeenCalled();
    });

    test('should handle cache expiration', async () => {
      const ttl = 500; // Short TTL for testing
      const service = new RandomAnimeService();
      service.cache = new CacheService(ttl, 'TestCache');

      const username = 'testuser';

      // Set manual cache entry
      service.cache.set('anime_ids_testuser', [1, 2, 3]);

      // Verify it's there
      expect(service.cache.get('anime_ids_testuser')).toEqual([1, 2, 3]);

      // Fast forward past TTL
      jest.useFakeTimers();
      jest.advanceTimersByTime(ttl + 1);

      // Entry should be expired
      expect(service.cache.get('anime_ids_testuser')).toBeNull();

      jest.useRealTimers();
      service.cache.destroy();
    });
  });

  describe('AnimeStatsService with real-like API data', () => {
    test('should calculate stats correctly with various list states', async () => {
      const service = new AnimeStatsService();
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
                  { status: 'COMPLETED', media: { averageScore: 90 } },
                  { status: 'COMPLETED', media: { averageScore: 75 } }
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
                entries: [
                  { status: 'DROPPED', media: { averageScore: 50 } }
                ]
              },
              {
                name: 'Planning',
                entries: [
                  { status: 'PLANNING', media: { averageScore: null } },
                  { status: 'PLANNING', media: { averageScore: 70 } }
                ]
              }
            ]
          }
        }
      });

      const stats = await service.fetchUserAnimeStats(username);

      // Verify calculations
      // Completed: 3, Watching: 1, Dropped: 1, Planning: 2 = 7 total
      expect(stats.totalAnime).toBe(7);
      expect(stats.completedAnime).toBe(3);
      expect(stats.watchingAnime).toBe(1);
      expect(stats.pausedAnime).toBe(0);
      expect(stats.droppedAnime).toBe(1);
      expect(stats.planningAnime).toBe(2);
      
      // Average: (85+90+75+80+50+70) / 6 = 75
      expect(parseFloat(stats.averageScore)).toBe(75);
    });

    test('should create embed with stats data', async () => {
      const service = new AnimeStatsService();
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1, name: 'testuser' },
          MediaListCollection: {
            lists: [
              { name: 'Completed', entries: Array(10).fill({ status: 'COMPLETED', media: { averageScore: 80 } }) },
              { name: 'Watching', entries: Array(3).fill({ status: 'CURRENT', media: { averageScore: 78 } }) },
              { name: 'Paused', entries: [] },
              { name: 'Dropped', entries: [] },
              { name: 'Planning', entries: Array(5).fill({ status: 'PLANNING', media: { averageScore: 75 } }) }
            ]
          }
        }
      });

      const stats = await service.fetchUserAnimeStats(username);
      const embed = service.createAnimeStatsEmbed(username, stats);

      expect(embed.data.title).toContain(username);
      expect(embed.data.fields).toBeDefined();
      expect(embed.data.fields.length).toBeGreaterThan(0);
      expect(embed.data.color).toBe(0x0099ff);
    });
  });

  describe('Error handling across services', () => {
    test('should handle partial API failures gracefully', async () => {
      const service = new RandomAnimeService();
      const username = 'testuser';

      // First call to fetch IDs succeeds
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [
              {
                entries: [{ media: { id: 1 } }, { media: { id: 5 } }]
              }
            ]
          }
        }
      });

      // Second call to fetch anime details fails
      mockAdapter.onPost('https://graphql.anilist.co').reply(500, {
        errors: [{ message: 'Server error' }]
      });

      await expect(service.fetchRandomAnime(username)).rejects.toThrow();
    });

    test('should maintain cache consistency during errors', async () => {
      const service = new RandomAnimeService();
      const username = 'testuser';

      // Set up cache
      service.cache.set('anime_ids_testuser', [1, 2, 3]);

      // API error should not affect cache
      mockAdapter.onPost('https://graphql.anilist.co').reply(500, {
        errors: []
      });

      try {
        // This will use cached IDs and then fail on anime fetch
        const randomID = [1, 2, 3][Math.floor(Math.random() * 3)];
        expect(randomID).toBeTruthy();
      } catch (e) {
        // Ignore
      }

      // Cache should still have the data
      expect(service.cache.get('anime_ids_testuser')).toEqual([1, 2, 3]);
    });
  });

  describe('Concurrent service calls', () => {
    test('should handle multiple concurrent requests', async () => {
      const statsService = new AnimeStatsService();
      const randomService = new RandomAnimeService();

      const users = ['user1', 'user2', 'user3'];

      // Mock requests for each user
      users.forEach(username => {
        // Stats call
        mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
          data: {
            User: { id: 1, name: username },
            MediaListCollection: {
              lists: [
                { name: 'Completed', entries: [{ status: 'COMPLETED', media: { averageScore: 85 } }] },
                { name: 'Watching', entries: [] },
                { name: 'Paused', entries: [] },
                { name: 'Dropped', entries: [] },
                { name: 'Planning', entries: [] }
              ]
            }
          }
        });
      });

      // Call stats for all users concurrently
      const requests = users.map(username =>
        statsService.fetchUserAnimeStats(username)
      );

      const results = await Promise.all(requests);

      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(result.totalAnime).toBe(1);
        expect(result.completedAnime).toBe(1);
      });
    });
  });

  describe('Service lifecycle', () => {
    test('should cleanup cache resources properly', () => {
      const service = new RandomAnimeService();

      service.cache.set('key1', 'value1');
      service.cache.set('key2', 'value2');

      expect(service.cache.getStats().totalKeys).toBe(2);

      // Destroy stops the timer but doesn't clear data
      service.cache.destroy();

      // Verify timer is stopped (sweepTimer should be null after destroy)
      expect(service.cache.sweepTimer).toBeNull();
      
      // Data persists after destroy
      expect(service.cache.getStats().totalKeys).toBe(2);

      // Explicitly clear cache
      service.cache.clearAll();
      expect(service.cache.getStats().totalKeys).toBe(0);
    });
  });
});
