const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const RandomMangaService = require('../../modules/RandomMangaService');
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

describe('RandomMangaService', () => {
  let service;
  let mockAdapter;

  beforeEach(() => {
    service = new RandomMangaService();
    mockAdapter = new MockAdapter(axios);
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAdapter.reset();
  });

  describe('commandDefinition', () => {
    test('defines the mangarandom command wired through to the handler', () => {
      const definition = RandomMangaService.commandDefinition;

      expect(definition.builder.name).toBe('mangarandom');
      expect(definition.builder.description).toBe(
        "Get a random manga from a user's AniList"
      );

      const usernameOption = definition.builder.options[0];
      expect(usernameOption.name).toBe('username');
      expect(usernameOption.required).toBe(true);

      expect(definition.methodName).toBe('handleRandomMangaCommand');
      expect(definition.metricName).toBe('manga_random');
    });
  });

  describe('fetchRandomManga', () => {
    test('should return a random manga from user list', async () => {
      const username = 'testuser';
      const mockMangaIds = [1, 5, 10, 15];
      const mockMangaId = 5;

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [
              {
                entries: mockMangaIds.map(id => ({ media: { id } }))
              }
            ]
          }
        }
      });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaList: {
            media: {
              id: mockMangaId,
              title: {
                english: 'Test Manga',
                romaji: 'テスト マンガ'
              },
              chapters: 120,
              volumes: 8,
              format: 'MANGA',
              status: 'FINISHED',
              genres: ['Action', 'Adventure'],
              description: 'A test manga',
              averageScore: 85,
              startDate: { year: 2024 },
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

      const result = await service.fetchRandomManga(username);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockMangaId);
      expect(result.title).toBeDefined();
      expect(result.chapters).toBe(120);
      expect(result.volumes).toBe(8);
    });

    test('should use cached manga IDs on second call', async () => {
      const username = 'testuser';
      const mockMangaIds = [1, 5, 10];

      // First call - populate cache
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [
              {
                entries: mockMangaIds.map(id => ({ media: { id } }))
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
              title: { english: 'Test Manga', romaji: 'テスト' },
              chapters: 120,
              volumes: 8,
              format: 'MANGA',
              status: 'FINISHED',
              genres: [],
              description: '',
              averageScore: 80,
              startDate: { year: 2024 },
              coverImage: { large: 'url', extraLarge: 'url' }
            },
            status: 'COMPLETED',
            score: 9
          }
        }
      });

      await service.fetchRandomManga(username);

      // Second call should use cache
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          MediaList: {
            media: {
              id: 10,
              title: { english: 'Test Manga 2', romaji: 'テスト2' },
              chapters: 200,
              volumes: 12,
              format: 'MANGA',
              status: 'FINISHED',
              genres: [],
              description: '',
              averageScore: 75,
              startDate: { year: 2024 },
              coverImage: { large: 'url', extraLarge: 'url' }
            },
            status: 'COMPLETED',
            score: 8
          }
        }
      });

      const result = await service.fetchRandomManga(username);
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

      await expect(service.fetchRandomManga(username)).rejects.toThrow(
        'not found on AniList'
      );
    });

    test('should throw error if user has no manga', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: []
          }
        }
      });

      await expect(service.fetchRandomManga(username)).rejects.toThrow(
        'No manga found'
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
              chapters: 10,
              volumes: 2,
              format: 'MANGA',
              status: 'FINISHED',
              genres: [],
              description: '',
              averageScore: 80,
              startDate: { year: 2024 },
              coverImage: { large: 'url', extraLarge: 'url' }
            },
            status: 'COMPLETED',
            score: 9
          }
        }
      });

      try {
        await service.fetchRandomManga(username);
      } catch (e) {
        // Ignore
      }

      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'manga_random',
        'started',
        username
      );
    });
  });

  describe('error handling', () => {
    test('should handle network errors gracefully', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await expect(service.fetchRandomManga(username)).rejects.toThrow();
    });

    test('should handle malformed API response', async () => {
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').reply(200, {
        data: undefined
      });

      await expect(service.fetchRandomManga(username)).rejects.toThrow();
    });

    test('does not track success when the API returns no MediaList', async () => {
      const username = 'testuser';
      const metrics = require('../../metrics');

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          User: { id: 1 },
          MediaListCollection: {
            lists: [{ entries: [{ media: { id: 5 } }] }]
          }
        }
      });
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: { MediaList: null }
      });

      await expect(service.fetchRandomManga(username)).rejects.toThrow('No manga data found');

      const successCalls = metrics.trackApiRequest.mock.calls.filter(
        call => call[1] === 'success'
      );
      expect(successCalls).toHaveLength(0);
    });
  });

  describe('handleRandomMangaCommand', () => {
    const mockIdsResponse = {
      data: {
        User: { id: 1 },
        MediaListCollection: {
          lists: [{ entries: [{ media: { id: 5 } }] }]
        }
      }
    };

    const mockMangaResponse = {
      data: {
        MediaList: {
          media: {
            id: 5,
            title: { english: 'Test Manga', romaji: 'テスト マンガ' },
            chapters: 120,
            volumes: 8,
            format: 'MANGA',
            status: 'FINISHED',
            genres: ['Action'],
            description: 'A test manga',
            averageScore: 85,
            startDate: { year: 2024 },
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

    test('should defer then edit the reply with the manga embed on success', async () => {
      const interaction = createMockInteraction({ commandName: 'mangarandom' });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, mockIdsResponse);
      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, mockMangaResponse);

      await service.handleRandomMangaCommand(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: false });
      expect(interaction.editReply).toHaveBeenCalledTimes(1);
      const embed = interaction.editReply.mock.calls[0][0].embeds[0];
      expect(embed.data.title).toBe('🌟 Test Manga');
    });

    test('should ask for a username when the option is missing', async () => {
      const interaction = createMockInteraction({
        commandName: 'mangarandom',
        options: { getString: jest.fn().mockReturnValue(undefined) }
      });

      await service.handleRandomMangaCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ Please provide a valid AniList username.'
      });
      expect(mockAdapter.history.post.length).toBe(0);
    });

    test('should edit the reply with a friendly error when fetching fails', async () => {
      const interaction = createMockInteraction({ commandName: 'mangarandom' });
      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await service.handleRandomMangaCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith({
        content: expect.stringContaining('❌ Error fetching manga for testuser')
      });
    });

    test('should fall back to reply() when deferReply itself fails', async () => {
      const interaction = createMockInteraction({
        commandName: 'mangarandom',
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction'))
      });

      await service.handleRandomMangaCommand(interaction);

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
        commandName: 'mangarandom',
        editReply: jest.fn()
          .mockRejectedValueOnce(new Error('cannot edit'))
          .mockResolvedValueOnce(undefined)
      });
      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await service.handleRandomMangaCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledTimes(2);
      expect(interaction.editReply).toHaveBeenLastCalledWith({
        content: '❌ An unexpected error occurred. Please try again later.',
        ephemeral: true
      });
    });

    test('logs and stays silent when every response path fails', async () => {
      const metrics = require('../../metrics');
      const logger = require('../../logger');
      const interaction = createMockInteraction({
        commandName: 'mangarandom',
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction')),
        reply: jest.fn().mockRejectedValue(new Error('cannot reply'))
      });

      await expect(service.handleRandomMangaCommand(interaction)).resolves.toBeUndefined();

      expect(metrics.trackError).toHaveBeenCalledWith('Error', 'manga_random');
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send final error message',
        expect.any(Object)
      );
    });
  });

  describe('createMangaEmbed', () => {
    const baseManga = {
      id: 5,
      title: 'Test Manga',
      chapters: 120,
      volumes: 8,
      format: 'MANGA',
      status: 'COMPLETED',
      genres: ['Action', 'Adventure'],
      year: 2024,
      description: 'A test manga',
      userScore: 9,
      averageScore: 85,
      coverImage: 'https://example.com/cover_large.jpg'
    };

    test('should strip HTML tags and collapse whitespace in descriptions', () => {
      const embed = service.createMangaEmbed({
        ...baseManga,
        description: '<p>Hello world</p>\n\n  second part'
      });

      expect(embed.data.description).toBe('📝 Hello world second part');
    });

    test('should truncate descriptions over 200 characters with an ellipsis', () => {
      const embed = service.createMangaEmbed({
        ...baseManga,
        description: 'a'.repeat(300)
      });

      expect(embed.data.description).toBe(`📝 ${'a'.repeat(200)}...`);
    });

    test('should use a default description when none is provided', () => {
      const embed = service.createMangaEmbed({ ...baseManga, description: '' });

      expect(embed.data.description).toBe('📝 No description available');
    });

    test('should map known status and format values to emojis', () => {
      const embed = service.createMangaEmbed(baseManga);

      expect(embed.data.fields.find(f => f.name === '📡 Status').value).toBe('✅ COMPLETED');
      expect(embed.data.fields.find(f => f.name === '🎭 Format').value).toBe('📖 MANGA');
    });

    test('should use fallback emojis for unknown status and format', () => {
      const embed = service.createMangaEmbed({
        ...baseManga,
        status: 'HIATUS',
        format: 'UNKNOWN'
      });

      expect(embed.data.fields.find(f => f.name === '📡 Status').value).toBe('❓ HIATUS');
      expect(embed.data.fields.find(f => f.name === '🎭 Format').value).toBe('🎴 UNKNOWN');
    });

    test('should map manga-specific format emojis', () => {
      const novel = service.createMangaEmbed({ ...baseManga, format: 'NOVEL' });

      expect(novel.data.fields.find(f => f.name === '🎭 Format').value).toBe('📓 NOVEL');
    });

    test('should build title, link and color from the manga', () => {
      const embed = service.createMangaEmbed(baseManga);

      expect(embed.data.title).toBe('🌟 Test Manga');
      expect(embed.data.url).toBe('https://anilist.co/manga/5');
      expect(embed.data.color).toBe(0x0099ff);
    });

    test('should render genre hashtags and the empty-list fallback', () => {
      const embed = service.createMangaEmbed(baseManga);
      expect(embed.data.fields.find(f => f.name === '🏷️ Genres').value).toBe('#Action #Adventure');

      const emptyGenres = service.createMangaEmbed({ ...baseManga, genres: [] });
      expect(emptyGenres.data.fields.find(f => f.name === '🏷️ Genres').value).toBe('No genres');
    });

    test('should show chapters and volumes with fallbacks for missing values', () => {
      const embed = service.createMangaEmbed(baseManga);

      expect(embed.data.fields.find(f => f.name === '📖 Chapters').value).toBe('🔢 120');
      expect(embed.data.fields.find(f => f.name === '📚 Volumes').value).toBe('🔢 8');
    });

    test('should use fallbacks for missing chapters, volumes, year, scores and zero averageScore', () => {
      const embed = service.createMangaEmbed({
        ...baseManga,
        chapters: 'Unknown',
        volumes: 'Unknown',
        year: null,
        userScore: null,
        averageScore: 0
      });

      expect(embed.data.fields.find(f => f.name === '📖 Chapters').value).toBe('🔢 Unknown');
      expect(embed.data.fields.find(f => f.name === '📚 Volumes').value).toBe('🔢 Unknown');
      expect(embed.data.fields.find(f => f.name === '📅 Year').value).toBe('🗓️ Unknown');
      expect(embed.data.fields.find(f => f.name === '⭐ Your Score').value).toBe('📊 Not rated');
      expect(embed.data.fields.find(f => f.name === '📈 Average Score').value).toBe('🌈 N/A%');
    });

    test('should set the cover image for a valid https URL', () => {
      const embed = service.createMangaEmbed(baseManga);

      expect(embed.data.image.url).toBe('https://example.com/cover_large.jpg');
    });

    test('should omit the image for non-http URLs', () => {
      const ftp = service.createMangaEmbed({ ...baseManga, coverImage: 'ftp://example.com/cover.jpg' });
      const garbage = service.createMangaEmbed({ ...baseManga, coverImage: 'not-a-url' });

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
