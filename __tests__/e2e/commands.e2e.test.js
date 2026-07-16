const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const RandomAnimeService = require('../../modules/RandomAnimeService');
const AnimeRecommendationService = require('../../modules/animeRecommendation');
const AnimeStatsService = require('../../modules/AnimeStatsService');
const AnimeCoverService = require('../../modules/AnimeCoverService');

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

describe('E2E Tests - Command Interactions', () => {
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = new MockAdapter(axios);
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAdapter.reset();
  });

  describe('/random_anime command', () => {
    test('should execute random anime command successfully', async () => {
      const service = new RandomAnimeService();
      const username = 'testuser';

      // Mock API responses
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [
              {
                entries: [
                  { media: { id: 1 } },
                  { media: { id: 5 } },
                  { media: { id: 10 } }
                ]
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
              title: {
                english: 'Fullmetal Alchemist',
                romaji: 'フルメタルアルケミスト'
              },
              episodes: 51,
              format: 'TV',
              status: 'FINISHED',
              genres: ['Action', 'Adventure', 'Drama'],
              description: 'A story about two brothers',
              averageScore: 92,
              seasonYear: 2005,
              coverImage: {
                large: 'https://example.com/cover.jpg',
                extraLarge: 'https://example.com/cover_large.jpg'
              }
            },
            status: 'COMPLETED',
            score: 10
          }
        }
      });

      const result = await service.fetchRandomAnime(username);

      // Verify command completed successfully
      expect(result).toBeDefined();
      expect(result.id).toBe(5);
      expect(result.title).toBe('Fullmetal Alchemist');
      expect(result.episodes).toBe(51);
      expect(result.genres).toContain('Action');

      // Verify no errors
      const logger = require('../../logger');
      expect(logger.error).not.toHaveBeenCalled();
    });

    test('should handle command error gracefully', async () => {
      const service = new RandomAnimeService();
      const username = 'nonexistent';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: null,
          MediaListCollection: { lists: [] }
        }
      });

      let errorCaught = false;
      try {
        await service.fetchRandomAnime(username);
      } catch (error) {
        errorCaught = true;
        expect(error.message).toContain('not found');
      }

      expect(errorCaught).toBe(true);
    });
  });

  describe('/anime_stats command', () => {
    test('should execute anime stats command successfully', async () => {
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
                  { status: 'COMPLETED', media: { averageScore: 92 } },
                  { status: 'COMPLETED', media: { averageScore: 88 } }
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
      const embed = service.createAnimeStatsEmbed(username, stats);

      // Verify stats are correct
      expect(stats.totalAnime).toBe(5);
      expect(stats.completedAnime).toBe(3);
      expect(stats.watchingAnime).toBe(1);
      expect(stats.planningAnime).toBe(1);

      // Verify embed was created
      expect(embed.data.title).toContain('testuser');
      expect(embed.data.fields).toBeDefined();
      expect(embed.data.fields.length).toBeGreaterThan(0);

      // Verify metrics tracking
      const metrics = require('../../metrics');
      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'anime_stats',
        'started',
        username
      );
    });

    test('should display stats embed with all fields', async () => {
      const service = new AnimeStatsService();
      const stats = {
        totalAnime: 50,
        completedAnime: 30,
        watchingAnime: 5,
        pausedAnime: 2,
        droppedAnime: 3,
        planningAnime: 10,
        averageScore: '85.50'
      };

      const embed = service.createAnimeStatsEmbed('testuser', stats);

      expect(embed.data.title).toContain('📊');
      expect(embed.data.title).toContain('testuser');
      expect(embed.data.fields.map(f => f.name)).toContainEqual(
        expect.stringMatching(/Total Anime/i)
      );
    });
  });

  describe('/anime_recommend command', () => {
    test('should execute recommendation command successfully', async () => {
      const service = new AnimeRecommendationService();
      const username = 'testuser';

      // First call for user's anime list
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaListCollection: {
            lists: [
              {
                entries: [
                  {
                    mediaId: 1,
                    status: 'COMPLETED',
                    score: 10,
                    media: {
                      id: 1,
                      title: {
                        english: 'Cowboy Bebop',
                        romaji: 'カウボーイビバップ'
                      },
                      genres: ['Action', 'Sci-Fi']
                    }
                  }
                ]
              }
            ]
          }
        }
      });

      // Second call for recommendations
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Page: {
            media: [
              {
                id: 100,
                title: {
                  english: 'Ghost in the Shell',
                  romaji: '攻殻機動隊'
                },
                description: 'A cyberpunk masterpiece',
                episodes: 26,
                format: 'TV',
                status: 'FINISHED',
                genres: ['Action', 'Sci-Fi'],
                seasonYear: 1995,
                averageScore: 85,
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

      // Verify recommendation
      expect(result).toBeDefined();
      expect(result.title).toBe('Ghost in the Shell');
      expect(result.genres).toContain('Sci-Fi');
      expect(result.id).toBe(100);
    });

    test('should handle recommendation embed creation', async () => {
      const service = new AnimeRecommendationService();
      const recommendation = {
        id: 100,
        title: 'Recommended Anime',
        description: 'A great anime with deep story',
        episodes: 12,
        format: 'TV',
        status: 'FINISHED',
        genres: ['Action', 'Drama'],
        year: 2023,
        averageScore: 88,
        coverImage: 'https://example.com/cover.jpg',
        matchedGenres: ['Action']
      };

      const embed = service.createAnimeRecommendationEmbed('testuser', recommendation);

      expect(embed.data.title).toContain('🌟');
      expect(embed.data.title).toContain('testuser');
      expect(embed.data.description).toContain('A great anime');
    });
  });

  describe('/anime_cover command', () => {
    test('should execute anime cover command successfully', async () => {
      const service = new AnimeCoverService();
      const animeId = 1;
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Media: {
            coverImage: {
              extraLarge: 'https://example.com/cowboy_bebop_cover.jpg'
            }
          }
        }
      });

      const coverUrl = await service.fetchAnimeCoverById(animeId, username);

      expect(coverUrl).toBe('https://example.com/cowboy_bebop_cover.jpg');
    });

    test('should handle missing cover gracefully', async () => {
      const service = new AnimeCoverService();
      const animeId = 999999;
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Media: {
            coverImage: {
              extraLarge: null
            }
          }
        }
      });

      const coverUrl = await service.fetchAnimeCoverById(animeId, username);

      expect(coverUrl).toBeNull();
    });

    test('should create embed with cover image', async () => {
      const service = new AnimeCoverService();
      const mockInteraction = {
        user: { username: 'testuser' },
        options: {
          getString: jest.fn().mockReturnValue('1')
        },
        deferReply: jest.fn().mockResolvedValue(undefined),
        editReply: jest.fn().mockResolvedValue(undefined)
      };

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Media: {
            coverImage: {
              extraLarge: 'https://example.com/cover.jpg'
            }
          }
        }
      });

      await service.handleAnimeCoverCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array)
        })
      );
    });
  });

  describe('Command error scenarios', () => {
    test('should handle API timeout errors', async () => {
      const service = new RandomAnimeService();
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').timeoutOnce();

      let errorCaught = false;
      try {
        await service.fetchRandomAnime(username);
      } catch (error) {
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);
    });

    test('should handle network errors', async () => {
      const service = new AnimeStatsService();
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      let errorCaught = false;
      try {
        await service.fetchUserAnimeStats(username);
      } catch (error) {
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);
    });

    test('should handle malformed API responses', async () => {
      const service = new AnimeRecommendationService();
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: null
      });

      let errorCaught = false;
      try {
        await service.fetchAnimeRecommendation(username);
      } catch (error) {
        errorCaught = true;
      }

      expect(errorCaught).toBe(true);
    });
  });

  describe('Command execution flow', () => {
    test('should track metrics for successful command', async () => {
      const service = new RandomAnimeService();
      const username = 'testuser';
      const metrics = require('../../metrics');

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [{ entries: [{ media: { id: 1 } }] }]
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

      // Verify tracking
      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'random_anime',
        'started',
        username
      );
    });
  });
});
