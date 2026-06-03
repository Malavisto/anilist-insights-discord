/**
 * Tests for MetricsService - Prometheus metrics tracking
 */
const MetricsService = require('../metrics');
const client = require('prom-client');
const logger = require('../logger');

describe('MetricsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // Constructor Tests
  describe('initialization', () => {
    test('initializes with all metric types', () => {
      expect(MetricsService.commandCounter).toBeDefined();
      expect(MetricsService.commandDuration).toBeDefined();
      expect(MetricsService.apiRequestCounter).toBeDefined();
      expect(MetricsService.cacheHitCounter).toBeDefined();
      expect(MetricsService.userStatsGauge).toBeDefined();
      expect(MetricsService.errorCounter).toBeDefined();
    });
  });

  // Command Tracking Tests
  describe('trackCommand', () => {
    test('increments command counter', () => {
      const result = MetricsService.trackCommand('random_anime', 'guild123');
      expect(MetricsService.commandCounter.inc).toHaveBeenCalled();
    });

    test('returns a function for ending timer', () => {
      const endTimer = MetricsService.trackCommand('anime_stats', 'guild456');
      expect(typeof endTimer).toBe('function');
    });

    test('handles undefined guildId gracefully', () => {
      MetricsService.trackCommand('anime_cover');
      expect(MetricsService.commandCounter.inc).toHaveBeenCalled();
    });

    test('catches and logs errors during tracking', () => {
      MetricsService.commandCounter.inc.mockImplementationOnce(() => {
        throw new Error('Metrics error');
      });

      const endTimer = MetricsService.trackCommand('test_command', 'guild123');

      expect(logger.error).toHaveBeenCalled();
    });
  });

  // API Request Tracking Tests
  describe('trackApiRequest', () => {
    test('increments API request counter', () => {
      MetricsService.trackApiRequest('user_list', 'success', 'testuser');
      expect(MetricsService.apiRequestCounter.inc).toHaveBeenCalled();
    });

    test('defaults username to "unknown" when not provided', () => {
      MetricsService.trackApiRequest('user_list', 'success');
      expect(MetricsService.apiRequestCounter.inc).toHaveBeenCalled();
    });

    test('tracks failed API requests', () => {
      MetricsService.trackApiRequest('user_list', 'error', 'faileduser');
      expect(MetricsService.apiRequestCounter.inc).toHaveBeenCalled();
    });

    test('catches and logs errors', () => {
      MetricsService.apiRequestCounter.inc.mockImplementationOnce(() => {
        throw new Error('Counter error');
      });

      MetricsService.trackApiRequest('test_endpoint', 'success', 'user');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // Cache Hit Tracking Tests
  describe('trackCacheHit', () => {
    test('increments cache hit counter', () => {
      MetricsService.trackCacheHit('random_anime');
      expect(MetricsService.cacheHitCounter.inc).toHaveBeenCalled();
    });

    test('tracks different cache types', () => {
      MetricsService.trackCacheHit('anime_stats');
      MetricsService.trackCacheHit('anime_cover');
      expect(MetricsService.cacheHitCounter.inc).toHaveBeenCalledTimes(2);
    });

    test('catches and logs errors', () => {
      MetricsService.cacheHitCounter.inc.mockImplementationOnce(() => {
        throw new Error('Cache hit error');
      });

      MetricsService.trackCacheHit('test_cache');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // Error Tracking Tests
  describe('trackError', () => {
    test('increments error counter', () => {
      MetricsService.trackError('user_not_found', 'random_anime');
      expect(MetricsService.errorCounter.inc).toHaveBeenCalled();
    });

    test('tracks different error types', () => {
      MetricsService.trackError('api_timeout', 'anime_stats');
      MetricsService.trackError('invalid_input', 'anime_recommend');
      expect(MetricsService.errorCounter.inc).toHaveBeenCalledTimes(2);
    });

    test('handles undefined command type', () => {
      MetricsService.trackError('unknown_error');
      expect(MetricsService.errorCounter.inc).toHaveBeenCalled();
    });

    test('catches and logs errors', () => {
      MetricsService.errorCounter.inc.mockImplementationOnce(() => {
        throw new Error('Error tracking error');
      });

      MetricsService.trackError('test_error', 'test_command');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // User Stats Tracking Tests
  describe('updateUserStats', () => {
    test('updates user stats gauge', () => {
      MetricsService.updateUserStats('anime_count', 'testuser', 150);
      expect(MetricsService.userStatsGauge.set).toHaveBeenCalled();
    });

    test('tracks multiple user stat types', () => {
      MetricsService.updateUserStats('anime_count', 'user1', 100);
      MetricsService.updateUserStats('total_score', 'user1', 7500);
      MetricsService.updateUserStats('mean_score', 'user1', 75);
      expect(MetricsService.userStatsGauge.set).toHaveBeenCalledTimes(3);
    });

    test('tracks stats for different users', () => {
      MetricsService.updateUserStats('anime_count', 'user1', 100);
      MetricsService.updateUserStats('anime_count', 'user2', 250);
      expect(MetricsService.userStatsGauge.set).toHaveBeenCalledTimes(2);
    });

    test('handles zero and negative values', () => {
      MetricsService.updateUserStats('metric', 'user', 0);
      MetricsService.updateUserStats('metric', 'user', -10);
      expect(MetricsService.userStatsGauge.set).toHaveBeenCalledTimes(2);
    });

    test('catches and logs errors', () => {
      MetricsService.userStatsGauge.set.mockImplementationOnce(() => {
        throw new Error('Gauge update error');
      });

      MetricsService.updateUserStats('metric', 'user', 100);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  // Metrics Retrieval Tests
  describe('getMetrics', () => {
    test('returns metrics asynchronously', async () => {
      const metrics = await MetricsService.getMetrics();
      expect(typeof metrics).toBe('string');
    });
  });

  // Integration Tests
  describe('integration scenarios', () => {
    test('tracks a complete command execution flow', () => {
      const endTimer = MetricsService.trackCommand('random_anime', 'guild1');
      MetricsService.trackApiRequest('user_list', 'started', 'testuser');
      MetricsService.trackApiRequest('user_list', 'success', 'testuser');
      MetricsService.trackCacheHit('random_anime');

      expect(MetricsService.commandCounter.inc).toHaveBeenCalled();
      expect(MetricsService.apiRequestCounter.inc).toHaveBeenCalled();
      expect(MetricsService.cacheHitCounter.inc).toHaveBeenCalled();
    });

    test('tracks command with error', () => {
      MetricsService.trackCommand('anime_stats', 'guild2');
      MetricsService.trackApiRequest('user_list', 'error', 'invaliduser');
      MetricsService.trackError('user_not_found', 'anime_stats');

      expect(MetricsService.commandCounter.inc).toHaveBeenCalled();
      expect(MetricsService.apiRequestCounter.inc).toHaveBeenCalled();
      expect(MetricsService.errorCounter.inc).toHaveBeenCalled();
    });

    test('tracks multiple commands from different guilds', () => {
      MetricsService.trackCommand('random_anime', 'guild1');
      MetricsService.trackCommand('anime_stats', 'guild1');
      MetricsService.trackCommand('anime_recommend', 'guild2');

      expect(MetricsService.commandCounter.inc).toHaveBeenCalled();
    });
  });

  // Error Resilience Tests
  describe('error resilience', () => {
    test('continues working after counter error', () => {
      MetricsService.commandCounter.inc.mockImplementationOnce(() => {
        throw new Error('Counter broken');
      });

      const endTimer = MetricsService.trackCommand('cmd1', 'guild1');

      // Recovery: counter works again
      MetricsService.commandCounter.inc.mockRestore();

      MetricsService.trackCommand('cmd2', 'guild1');
      expect(MetricsService.commandCounter.inc).toHaveBeenCalled();
    });

    test('all tracking methods are independent', () => {
      MetricsService.commandCounter.inc.mockImplementationOnce(() => {
        throw new Error('Command counter broken');
      });

      MetricsService.trackApiRequest('endpoint', 'success', 'user');
      MetricsService.trackCacheHit('cache');
      MetricsService.trackError('error', 'cmd');
      MetricsService.updateUserStats('stat', 'user', 100);

      expect(MetricsService.apiRequestCounter.inc).toHaveBeenCalled();
      expect(MetricsService.cacheHitCounter.inc).toHaveBeenCalled();
      expect(MetricsService.errorCounter.inc).toHaveBeenCalled();
      expect(MetricsService.userStatsGauge.set).toHaveBeenCalled();
    });
  });
});
