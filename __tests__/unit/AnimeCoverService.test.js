const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const AnimeCoverService = require('../../modules/AnimeCoverService');
const { createMockInteraction } = require('../helpers/mockInteraction');

jest.mock('../../logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../metrics', () => ({
  trackApiRequest: jest.fn(),
  trackError: jest.fn(),
  trackCommand: jest.fn(() => jest.fn())
}));

describe('AnimeCoverService', () => {
  let service;
  let mockAdapter;

  beforeEach(() => {
    service = new AnimeCoverService();
    mockAdapter = new MockAdapter(axios);
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockAdapter.reset();
  });

  describe('fetchAnimeCoverById', () => {
    test('should fetch anime cover image URL', async () => {
      const animeId = 1;
      const username = 'testuser';
      const coverUrl = 'https://example.com/cover.jpg';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Media: {
            coverImage: {
              extraLarge: coverUrl
            }
          }
        }
      });

      const result = await service.fetchAnimeCoverById(animeId, username);

      expect(result).toBe(coverUrl);
    });

    test('should return null if cover image not found', async () => {
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

      const result = await service.fetchAnimeCoverById(animeId, username);

      expect(result).toBeNull();
    });

    test('should handle missing Media object', async () => {
      const animeId = 999999;
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Media: null
        }
      });

      const result = await service.fetchAnimeCoverById(animeId, username);

      expect(result).toBeNull();
    });

    test('should return null for malformed response', async () => {
      const animeId = 1;
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {}
      });

      const result = await service.fetchAnimeCoverById(animeId, username);

      expect(result).toBeNull();
    });

    test('should throw error on network failure', async () => {
      const animeId = 1;
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      await expect(service.fetchAnimeCoverById(animeId, username)).rejects.toThrow();
    });

    test('should track errors on API failure', async () => {
      const animeId = 1;
      const username = 'testuser';
      const metrics = require('../../metrics');

      mockAdapter.onPost('https://graphql.anilist.co').networkError();

      try {
        await service.fetchAnimeCoverById(animeId, username);
      } catch (e) {
        // Expected
      }

      expect(metrics.trackError).toHaveBeenCalledWith(
        'cover_fetch_failure',
        'anime_cover'
      );
      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'anime_cover',
        'failure',
        username
      );
    });

    test('should parse anime ID as integer', async () => {
      const animeId = '1'; // String instead of number
      const username = 'testuser';
      const coverUrl = 'https://example.com/cover.jpg';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Media: {
            coverImage: {
              extraLarge: coverUrl
            }
          }
        }
      });

      const result = await service.fetchAnimeCoverById(animeId, username);

      expect(result).toBe(coverUrl);
    });
  });

  describe('handleAnimeCoverCommand', () => {
    test('should defer reply when handling command', async () => {
      const mockInteraction = createMockInteraction({
        commandName: 'animecover',
        options: { getString: jest.fn().mockReturnValue('1') }
      });

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

      expect(mockInteraction.deferReply).toHaveBeenCalled();
    });

    test('should validate anime ID format', async () => {
      const mockInteraction = createMockInteraction({
        commandName: 'animecover',
        options: { getString: jest.fn().mockReturnValue('invalid') }
      });

      await service.handleAnimeCoverCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/valid anime ID/i)
      );
    });

    test('should handle empty anime ID', async () => {
      const mockInteraction = createMockInteraction({
        commandName: 'animecover',
        options: { getString: jest.fn().mockReturnValue('') }
      });

      await service.handleAnimeCoverCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/valid anime ID/i)
      );
    });

    test('should reply with error if no cover found', async () => {
      const mockInteraction = createMockInteraction({
        commandName: 'animecover',
        options: { getString: jest.fn().mockReturnValue('999999') }
      });

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Media: {
            coverImage: {
              extraLarge: null
            }
          }
        }
      });

      const metrics = require('../../metrics');

      await service.handleAnimeCoverCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.stringMatching(/No cover image found/i)
      );
      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'anime_cover',
        'failure',
        'testuser'
      );
    });

    test('should send embed with cover image on success', async () => {
      const mockInteraction = createMockInteraction({
        commandName: 'animecover',
        options: { getString: jest.fn().mockReturnValue('1') }
      });

      const coverUrl = 'https://example.com/cover.jpg';

      mockAdapter.onPost('https://graphql.anilist.co').replyOnce(200, {
        data: {
          Media: {
            coverImage: {
              extraLarge: coverUrl
            }
          }
        }
      });

      const metrics = require('../../metrics');

      await service.handleAnimeCoverCommand(mockInteraction);

      expect(mockInteraction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array)
        })
      );
      expect(metrics.trackApiRequest).toHaveBeenCalledWith(
        'anime_cover',
        'success',
        'testuser'
      );
    });

    test('should reply ephemerally when deferReply fails', async () => {
      const mockInteraction = createMockInteraction({
        commandName: 'animecover',
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction'))
      });

      await service.handleAnimeCoverCommand(mockInteraction);

      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('An error occurred while fetching the anime cover'),
          ephemeral: true
        })
      );
      expect(mockInteraction.editReply).not.toHaveBeenCalled();
    });

    test('should log when the fallback reply also fails', async () => {
      const logger = require('../../logger');
      const mockInteraction = createMockInteraction({
        commandName: 'animecover',
        deferReply: jest.fn().mockRejectedValue(new Error('Unknown interaction')),
        reply: jest.fn().mockRejectedValue(new Error('cannot reply'))
      });

      await expect(service.handleAnimeCoverCommand(mockInteraction)).resolves.toBeUndefined();

      expect(logger.error).toHaveBeenCalledWith(
        'Failed to send final error message',
        expect.any(Object)
      );
    });
  });

  describe('error handling', () => {
    test('should handle API errors gracefully', async () => {
      const animeId = 1;
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').reply(500, {
        errors: [{ message: 'Server error' }]
      });

      await expect(service.fetchAnimeCoverById(animeId, username)).rejects.toThrow();
    });

    test('should handle timeout errors', async () => {
      const animeId = 1;
      const username = 'testuser';

      mockAdapter.onPost('https://graphql.anilist.co').timeoutOnce();

      await expect(service.fetchAnimeCoverById(animeId, username)).rejects.toThrow();
    });
  });
});
