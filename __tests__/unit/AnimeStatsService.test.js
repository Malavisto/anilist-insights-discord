const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const AnimeStatsService = require('../../modules/AnimeStatsService');
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
                  { status: 'COMPLETED', score: 85, media: { averageScore: 85 } },
                  { status: 'COMPLETED', score: 90, media: { averageScore: 90 } }
                ]
              },
              {
                name: 'Watching',
                entries: [
                  { status: 'CURRENT', score: 80, media: { averageScore: 80 } }
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
                  { status: 'PLANNING', score: 75, media: { averageScore: 75 } }
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

    test('should exclude unrated entries from average score', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1, name: 'testuser' },
          MediaListCollection: {
            lists: [
              {
                name: 'Completed',
                entries: [
                  { status: 'COMPLETED', score: 0, media: { averageScore: null } },
                  { status: 'COMPLETED', score: 80, media: { averageScore: 80 } }
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

  describe('handleAnimeStatsCommand', () => {
    const mockStatsResponse = {
      data: {
        User: { id: 1, name: 'testuser' },
        MediaListCollection: {
          lists: [
            { name: 'Completed', entries: [{ status: 'COMPLETED', score: 85, media: { averageScore: 85 } }] },
            { name: 'Watching', entries: [] },
            { name: 'Paused', entries: [] },
            { name: 'Dropped', entries: [] },
            { name: 'Planning', entries: [] }
          ]
        }
      }
    };

    test('should defer then edit the reply with the stats embed on success', async () => {
      const interaction = createMockInteraction({ commandName: 'animestats' });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, mockStatsResponse);

      await service.handleAnimeStatsCommand(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      expect(interaction.editReply).toHaveBeenCalledTimes(1);
      const embed = interaction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('📊 Anime Stats for testuser');
    });

    test('should ask for a username when the option is missing', async () => {
      const interaction = createMockInteraction({
        commandName: 'animestats',
        options: { getString: jest.fn().mockReturnValue(undefined) }
      });

      await service.handleAnimeStatsCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ Please provide a valid AniList username.'
      });
      expect(mockAdapter.history.post.length).toBe(0);
    });

    test('should edit the reply with a friendly error when fetching fails', async () => {
      const interaction = createMockInteraction({ commandName: 'animestats' });
      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await service.handleAnimeStatsCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('❌ Error fetching anime stats for testuser')
      });
    });

    test('should fall back to reply() when deferReply itself fails', async () => {
      const interaction = createMockInteraction({
        commandName: 'animestats',
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction'))
      });

      await service.handleAnimeStatsCommand(interaction);

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
        commandName: 'animestats',
        editReply: jest.fn()
          .mockRejectedValueOnce(new Error('cannot edit'))
          .mockResolvedValueOnce(undefined)
      });
      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await service.handleAnimeStatsCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledTimes(2);
      expect(interaction.editReply).toHaveBeenLastCalledWith({
        content: '❌ An unexpected error occurred. Please try again later.',
        ephemeral: true
      });
    });

    test('should log and stay silent when every response path fails', async () => {
      const metrics = require('../../metrics');
      const logger = require('../../logger');
      const interaction = createMockInteraction({
        commandName: 'animestats',
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction')),
        reply: jest.fn().mockRejectedValue(new Error('cannot reply'))
      });

      await expect(service.handleAnimeStatsCommand(interaction)).resolves.toBeUndefined();

      // The stats final catch logs only - no metrics are tracked there
      expect(metrics.trackApiRequest).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send final error message',
        expect.any(Object)
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
