const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const AnimeRecommendationService = require('../../modules/commands/AnimeRecommendationService');
const { createMockInteraction } = require('../helpers/mockInteraction');

jest.mock('../../modules/observability/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
}));

jest.mock('../../modules/observability/metrics', () => ({
  trackApiRequest: jest.fn(),
  trackCacheHit: jest.fn(),
  trackError: jest.fn(),
  trackCommand: jest.fn(() => jest.fn()),
}));

describe('AnimeRecommendationService', () => {
  let service;
  let mockAdapter;

  beforeEach(() => {
    service = new AnimeRecommendationService();
    mockAdapter = new MockAdapter(axios);
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAdapter.reset();
  });

  describe('recommendation pagination', () => {
    const listed = { id: 1, genres: ['Action'] };
    const candidate = {
      id: 2,
      title: { english: 'New anime' },
      genres: ['Action'],
      episodes: 12,
      coverImage: { large: 'https://example.com/cover.jpg' },
    };
    beforeEach(() => {
      mockAdapter.onPost().replyOnce(200, {
        data: {
          MediaListCollection: {
            lists: [{ entries: [{ score: 9, media: listed }] }],
          },
        },
      });
      mockAdapter.onPost().replyOnce(200, {
        data: {
          Page: {
            media: [listed],
            pageInfo: { hasNextPage: true },
          },
        },
      });
    });

    test('finds an unseen title on a later page and caches it', async () => {
      mockAdapter.onPost().replyOnce(200, {
        data: {
          Page: {
            media: [listed, candidate],
            pageInfo: { hasNextPage: false },
          },
        },
      });
      const result = await service.fetchAnimeRecommendation('testuser');
      expect(result.id).toBe(2);
      const pages = mockAdapter.history.post
        .slice(1)
        .map((request) => JSON.parse(request.data).variables.page);
      expect(pages).toEqual([1, 2]);
      expect(
        require('../../modules/observability/metrics').trackApiRequest.mock.calls.map(
          (call) => call[1],
        ),
      ).toEqual(['started', 'success', 'started', 'success', 'started', 'success']);
      expect(await service.fetchAnimeRecommendation('testuser')).toEqual(result);
      expect(mockAdapter.history.post).toHaveLength(3);
    });

    test('collects alternatives across pages and avoids consecutive cached repeats', async () => {
      const alternate = { ...candidate, id: 3, title: { english: 'Another anime' } };
      mockAdapter.onPost().replyOnce(200, {
        data: {
          Page: {
            media: [listed, candidate],
            pageInfo: { hasNextPage: true },
          },
        },
      });
      mockAdapter.onPost().replyOnce(200, {
        data: {
          Page: {
            media: [candidate, alternate],
            pageInfo: { hasNextPage: false },
          },
        },
      });
      const random = jest.spyOn(Math, 'random').mockReturnValue(0);
      try {
        const results = [];
        for (let i = 0; i < 5; i++) {
          results.push((await service.fetchAnimeRecommendation('malavisto')).id);
        }
        expect(results).toEqual([2, 3, 2, 3, 2]);
        expect(
          service.cache.get('recommendation_malavisto').candidates.map((anime) => anime.id),
        ).toEqual([2, 3]);
        expect(mockAdapter.history.post).toHaveLength(4);
        expect(require('../../modules/observability/metrics').trackCacheHit).toHaveBeenCalledTimes(
          4,
        );
      } finally {
        random.mockRestore();
      }
    });

    test('stops collecting once five unique candidates are available', async () => {
      mockAdapter.onPost().replyOnce(200, {
        data: {
          Page: {
            media: Array.from({ length: 5 }, (_, index) => ({ ...candidate, id: index + 2 })),
            pageInfo: { hasNextPage: true },
          },
        },
      });
      await service.fetchAnimeRecommendation('testuser');
      expect(service.cache.get('recommendation_testuser').candidates).toHaveLength(5);
      expect(mockAdapter.history.post).toHaveLength(3);
    });

    test('refreshes the candidate pool after its TTL expires', async () => {
      mockAdapter.onPost().replyOnce(200, {
        data: {
          Page: {
            media: [candidate],
            pageInfo: { hasNextPage: false },
          },
        },
      });
      await service.fetchAnimeRecommendation('testuser');
      const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + service.cache.ttl + 1);
      try {
        mockAdapter.onPost().replyOnce(200, {
          data: {
            MediaListCollection: {
              lists: [{ entries: [{ score: 9, media: listed }] }],
            },
          },
        });
        mockAdapter.onPost().replyOnce(200, {
          data: {
            Page: {
              media: [{ ...candidate, id: 4 }],
              pageInfo: { hasNextPage: false },
            },
          },
        });
        expect((await service.fetchAnimeRecommendation('testuser')).id).toBe(4);
        expect(mockAdapter.history.post).toHaveLength(5);
      } finally {
        clock.mockRestore();
      }
    });

    test('stops when the final page has no unseen titles', async () => {
      mockAdapter.onPost().replyOnce(200, {
        data: {
          Page: {
            media: [listed],
            pageInfo: { hasNextPage: false },
          },
        },
      });
      await expect(service.fetchAnimeRecommendation('testuser')).rejects.toThrow(
        'No unique recommendations found',
      );
      expect(mockAdapter.history.post).toHaveLength(3);
      expect(service.cache.get('recommendation_testuser')).toBeNull();
    });

    test('propagates later-page failures without caching a result', async () => {
      mockAdapter.onPost().replyOnce(500);
      await expect(service.fetchAnimeRecommendation('testuser')).rejects.toThrow();
      expect(mockAdapter.history.post).toHaveLength(3);
      expect(service.cache.get('recommendation_testuser')).toBeNull();
    });
  });

  describe('fetchAnimeRecommendation', () => {
    test('should fetch recommendations based on user anime list', async () => {
      const username = 'testuser';

      // First API call - get user's anime list
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaListCollection: {
            lists: [
              {
                entries: [
                  {
                    mediaId: 1,
                    status: 'COMPLETED',
                    score: 9,
                    media: {
                      id: 1,
                      title: { english: 'Cowboy Bebop', romaji: 'カウボーイビバップ' },
                      genres: ['Action', 'Adventure'],
                    },
                  },
                  {
                    mediaId: 5,
                    status: 'COMPLETED',
                    score: 8,
                    media: {
                      id: 5,
                      title: { english: 'Fullmetal Alchemist', romaji: 'パンチ' },
                      genres: ['Action', 'Adventure', 'Fantasy'],
                    },
                  },
                ],
              },
            ],
          },
        },
      });

      // Second API call - get recommendations
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Page: {
            media: [
              {
                id: 100,
                title: { english: 'Recommended Anime 1', romaji: 'おすすめ1' },
                description: 'A great anime',
                episodes: 12,
                format: 'TV',
                status: 'FINISHED',
                genres: ['Action', 'Adventure'],
                seasonYear: 2024,
                averageScore: 85,
                coverImage: {
                  large: 'https://example.com/large.jpg',
                  extraLarge: 'https://example.com/extra.jpg',
                },
              },
              {
                id: 101,
                title: { english: 'Recommended Anime 2', romaji: 'おすすめ2' },
                description: 'Another great anime',
                episodes: 13,
                format: 'TV',
                status: 'FINISHED',
                genres: ['Action'],
                seasonYear: 2023,
                averageScore: 80,
                coverImage: {
                  large: 'https://example.com/large2.jpg',
                  extraLarge: 'https://example.com/extra2.jpg',
                },
              },
            ],
          },
        },
      });

      const result = await service.fetchAnimeRecommendation(username);

      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
      expect(result.title).toBeDefined();
      expect(result.description).toBeDefined();
      expect(result.genres).toBeDefined();
    });

    test('should use cached recommendation on second call', async () => {
      const username = 'testuser';

      // First call - populate cache
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaListCollection: {
            lists: [
              {
                entries: [
                  {
                    mediaId: 1,
                    status: 'COMPLETED',
                    score: 9,
                    media: {
                      id: 1,
                      title: { english: 'Test Anime', romaji: 'テスト' },
                      genres: ['Action'],
                    },
                  },
                ],
              },
            ],
          },
        },
      });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Page: {
            media: [
              {
                id: 100,
                title: { english: 'Recommendation', romaji: 'おすすめ' },
                description: 'Test',
                episodes: 12,
                format: 'TV',
                status: 'FINISHED',
                genres: ['Action'],
                seasonYear: 2024,
                averageScore: 82,
                coverImage: {
                  large: 'https://example.com/cover.jpg',
                  extraLarge: 'https://example.com/cover_extra.jpg',
                },
              },
            ],
          },
        },
      });

      const firstResult = await service.fetchAnimeRecommendation(username);

      // Second call should use cache
      const secondResult = await service.fetchAnimeRecommendation(username);

      expect(secondResult).toEqual(firstResult);
      const metrics = require('../../modules/observability/metrics');
      expect(metrics.trackCacheHit).toHaveBeenCalled();
    });

    test('should throw error if user has no rated anime', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaListCollection: {
            lists: [
              {
                entries: [
                  {
                    mediaId: 1,
                    status: 'COMPLETED',
                    score: 0, // No rating
                    media: {
                      id: 1,
                      title: { english: 'Test Anime', romaji: 'テスト' },
                      genres: ['Action'],
                    },
                  },
                ],
              },
            ],
          },
        },
      });

      await expect(service.fetchAnimeRecommendation(username)).rejects.toThrow(
        'No rated anime found',
      );
    });

    test('should filter out unrated anime', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaListCollection: {
            lists: [
              {
                entries: [
                  {
                    mediaId: 1,
                    status: 'COMPLETED',
                    score: 0,
                    media: {
                      id: 1,
                      title: { english: 'Unrated Anime', romaji: '未評価' },
                      genres: ['Action'],
                    },
                  },
                  {
                    mediaId: 2,
                    status: 'COMPLETED',
                    score: 8,
                    media: {
                      id: 2,
                      title: { english: 'Rated Anime', romaji: '評価済み' },
                      genres: ['Action', 'Adventure'],
                    },
                  },
                ],
              },
            ],
          },
        },
      });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Page: {
            media: [
              {
                id: 100,
                title: { english: 'Recommended', romaji: 'おすすめ' },
                description: 'Test',
                episodes: 12,
                format: 'TV',
                status: 'FINISHED',
                genres: ['Action'],
                seasonYear: 2024,
                averageScore: 80,
                coverImage: {
                  large: 'https://example.com/large.jpg',
                  extraLarge: 'https://example.com/extra.jpg',
                },
              },
            ],
          },
        },
      });

      const result = await service.fetchAnimeRecommendation(username);
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    test('should track API requests', async () => {
      const username = 'testuser';
      const metrics = require('../../modules/observability/metrics');

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: {
          MediaListCollection: {
            lists: [
              {
                entries: [
                  {
                    mediaId: 1,
                    status: 'COMPLETED',
                    score: 9,
                    media: {
                      id: 1,
                      title: { english: 'Test', romaji: 'テスト' },
                      genres: ['Action'],
                    },
                  },
                ],
              },
            ],
          },
        },
      });

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: {
          Page: {
            media: [
              {
                id: 100,
                title: { english: 'Rec', romaji: 'おすすめ' },
                description: 'Test',
                episodes: 12,
                format: 'TV',
                status: 'FINISHED',
                genres: ['Action'],
                seasonYear: 2024,
                averageScore: 80,
                coverImage: {
                  large: 'https://example.com/large.jpg',
                  extraLarge: 'https://example.com/extra.jpg',
                },
              },
            ],
          },
        },
      });

      try {
        await service.fetchAnimeRecommendation(username);
      } catch (e) {
        // Ignore
      }

      expect(metrics.trackApiRequest).toHaveBeenCalledWith('recommendation', 'started', username);
    });
  });

  describe('error handling', () => {
    test('should handle network errors', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await expect(service.fetchAnimeRecommendation(username)).rejects.toThrow();
    });

    test('should handle API errors', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').reply(500, {
        errors: [{ message: 'Server error' }],
      });

      await expect(service.fetchAnimeRecommendation(username)).rejects.toThrow();
    });
  });

  describe('handleAnimeRecommendCommand', () => {
    const mockListResponse = {
      data: {
        MediaListCollection: {
          lists: [
            {
              entries: [
                {
                  mediaId: 1,
                  status: 'COMPLETED',
                  score: 9,
                  media: {
                    id: 1,
                    title: { english: 'Cowboy Bebop', romaji: 'カウボーイビバップ' },
                    genres: ['Action', 'Adventure'],
                  },
                },
              ],
            },
          ],
        },
      },
    };

    const mockRecommendationResponse = {
      data: {
        Page: {
          media: [
            {
              id: 100,
              title: { english: 'Recommended Anime 1', romaji: 'おすすめ1' },
              description: 'A great anime',
              episodes: 12,
              format: 'TV',
              status: 'FINISHED',
              genres: ['Action', 'Adventure'],
              seasonYear: 2024,
              averageScore: 85,
              coverImage: {
                large: 'https://example.com/large.jpg',
                extraLarge: 'https://example.com/extra.jpg',
              },
            },
          ],
        },
      },
    };

    test('should defer then edit the reply with the recommendation embed on success', async () => {
      const interaction = createMockInteraction({ commandName: 'animerecommend' });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, mockListResponse);
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, mockRecommendationResponse);

      await service.handleAnimeRecommendCommand(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      expect(interaction.editReply).toHaveBeenCalledTimes(1);
      const embed = interaction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('🌟 Recommended Anime for testuser');
    });

    test('should ask for a username when the option is missing', async () => {
      const interaction = createMockInteraction({
        commandName: 'animerecommend',
        options: { getString: jest.fn().mockReturnValue(undefined) },
      });

      await service.handleAnimeRecommendCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ Please provide a valid AniList username.',
      });
      expect(mockAdapter.history.post.length).toBe(0);
    });

    test('should edit the reply with a friendly error when fetching fails', async () => {
      const interaction = createMockInteraction({ commandName: 'animerecommend' });
      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await service.handleAnimeRecommendCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('❌ Error fetching anime recommendation for testuser'),
      });
    });

    test('should fall back to reply() when deferReply itself fails', async () => {
      const interaction = createMockInteraction({
        commandName: 'animerecommend',
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction')),
      });

      await service.handleAnimeRecommendCommand(interaction);

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('An unexpected error occurred'),
          ephemeral: true,
        }),
      );
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    test('should fall back to editReply with the deferred visibility when the friendly error send fails', async () => {
      const interaction = createMockInteraction({
        commandName: 'animerecommend',
        editReply: jest
          .fn()
          .mockRejectedValueOnce(new Error('cannot edit'))
          .mockResolvedValueOnce(undefined),
      });
      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await service.handleAnimeRecommendCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledTimes(2);
      expect(interaction.editReply).toHaveBeenLastCalledWith({
        content: '❌ An unexpected error occurred. Please try again later.',
      });
    });

    test('should log and stay silent when every response path fails', async () => {
      const logger = require('../../modules/observability/logger');
      const interaction = createMockInteraction({
        commandName: 'animerecommend',
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction')),
        reply: jest.fn().mockRejectedValue(new Error('cannot reply')),
      });

      await expect(service.handleAnimeRecommendCommand(interaction)).resolves.toBe(false);

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send final error message',
        expect.any(Object),
      );
    });
  });

  describe('createAnimeRecommendationEmbed', () => {
    const baseAnime = {
      id: 7,
      title: 'Recommended Anime',
      episodes: 24,
      format: 'TV',
      status: 'RELEASING',
      genres: ['Action'],
      year: 2023,
      description: 'A great anime',
      averageScore: 88,
      coverImage: 'https://example.com/rec.jpg',
      matchedGenres: ['Action'],
    };

    test('should strip HTML and truncate long descriptions', () => {
      const clean = service.createAnimeRecommendationEmbed('testuser', {
        ...baseAnime,
        description: '<i>Great</i> anime\n really',
      });
      expect(clean.data.description).toBe('📝 Great anime really');

      const long = service.createAnimeRecommendationEmbed('testuser', {
        ...baseAnime,
        description: 'b'.repeat(250),
      });
      expect(long.data.description).toBe(`📝 ${'b'.repeat(200)}...`);
    });

    test('should use the default description when none is provided', () => {
      const embed = service.createAnimeRecommendationEmbed('testuser', {
        ...baseAnime,
        description: null,
      });

      expect(embed.data.description).toBe('📝 No description available');
    });

    test('should title the embed for the requesting user and link the anime', () => {
      const embed = service.createAnimeRecommendationEmbed('testuser', baseAnime);

      expect(embed.data.title).toBe('🌟 Recommended Anime for testuser');
      expect(embed.data.url).toBe('https://anilist.co/anime/7');
      expect(embed.data.color).toBe(0x00ff00);
      expect(embed.data.fields.find((f) => f.name === '🎬 Title').value).toBe('Recommended Anime');
    });

    test('should list matched genres or the no-match fallback', () => {
      const matched = service.createAnimeRecommendationEmbed('testuser', baseAnime);
      expect(matched.data.fields.find((f) => f.name === '🏷️ Matched Genres').value).toBe('#Action');

      const none = service.createAnimeRecommendationEmbed('testuser', {
        ...baseAnime,
        matchedGenres: [],
      });
      expect(none.data.fields.find((f) => f.name === '🏷️ Matched Genres').value).toBe(
        'No genre matches',
      );
    });

    test('should set the image only for valid http(s) URLs', () => {
      const valid = service.createAnimeRecommendationEmbed('testuser', baseAnime);
      expect(valid.data.image.url).toBe('https://example.com/rec.jpg');

      const invalid = service.createAnimeRecommendationEmbed('testuser', {
        ...baseAnime,
        coverImage: 'javascript:alert(1)',
      });
      expect(invalid.data.image).toBeUndefined();
    });

    test('should fall back to Unknown for a missing year', () => {
      const embed = service.createAnimeRecommendationEmbed('testuser', {
        ...baseAnime,
        year: null,
      });

      expect(embed.data.fields.find((f) => f.name === '📅 Year').value).toBe('Unknown');
    });
  });
});
