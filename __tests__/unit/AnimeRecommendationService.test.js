const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const AnimeRecommendationService = require('../../modules/animeRecommendation');

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
                      genres: ['Action', 'Adventure']
                    }
                  },
                  {
                    mediaId: 5,
                    status: 'COMPLETED',
                    score: 8,
                    media: {
                      id: 5,
                      title: { english: 'Fullmetal Alchemist', romaji: 'パンチ' },
                      genres: ['Action', 'Adventure', 'Fantasy']
                    }
                  }
                ]
              }
            ]
          }
        }
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
                  extraLarge: 'https://example.com/extra.jpg'
                }
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
                  extraLarge: 'https://example.com/extra2.jpg'
                }
              }
            ]
          }
        }
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
                      genres: ['Action']
                    }
                  }
                ]
              }
            ]
          }
        }
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
                  extraLarge: 'https://example.com/cover_extra.jpg'
                }
              }
            ]
          }
        }
      });

      const firstResult = await service.fetchAnimeRecommendation(username);

      // Second call should use cache
      const secondResult = await service.fetchAnimeRecommendation(username);

      expect(secondResult).toEqual(firstResult);
      const metrics = require('../../metrics');
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
                      genres: ['Action']
                    }
                  }
                ]
              }
            ]
          }
        }
      });

      await expect(service.fetchAnimeRecommendation(username)).rejects.toThrow(
        'No rated anime found'
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
                      genres: ['Action']
                    }
                  },
                  {
                    mediaId: 2,
                    status: 'COMPLETED',
                    score: 8,
                    media: {
                      id: 2,
                      title: { english: 'Rated Anime', romaji: '評価済み' },
                      genres: ['Action', 'Adventure']
                    }
                  }
                ]
              }
            ]
          }
        }
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
                  extraLarge: 'https://example.com/extra.jpg'
                }
              }
            ]
          }
        }
      });

      const result = await service.fetchAnimeRecommendation(username);
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    test('should track API requests', async () => {
      const username = 'testuser';
      const metrics = require('../../metrics');

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
                      genres: ['Action']
                    }
                  }
                ]
              }
            ]
          }
        }
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
                  extraLarge: 'https://example.com/extra.jpg'
                }
              }
            ]
          }
        }
      });

      try {
        await service.fetchAnimeRecommendation(username);
      } catch (e) {
        // Ignore
      }

      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'recommendation',
        'started',
        username
      );
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
        errors: [{ message: 'Server error' }]
      });

      await expect(service.fetchAnimeRecommendation(username)).rejects.toThrow();
    });
  });
});
