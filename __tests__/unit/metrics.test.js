const crypto = require('crypto');

jest.mock('../../logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn()
}));

// prom-client's global registry is per test file (jest isolates module
// registries), so other files' jest.mock('../../metrics') are unaffected.
const client = require('prom-client');

// Must run BEFORE requiring metrics.js: prom-client 15's
// collectDefaultMetrics() starts perf_hooks monitors that jest fake timers
// cannot stop, which would leave the worker with open handles. No-op it.
jest.spyOn(client, 'collectDefaultMetrics').mockImplementation(() => {});

const metricsService = require('../../metrics');

const sha256Prefix = (value) =>
  crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);

const getValues = async (metricName) => {
  const json = await client.register.getMetricsAsJSON();
  const metric = json.find(m => m.name === metricName);
  return metric ? metric.values : [];
};

const findValue = (values, labelMatch) =>
  values.find(v =>
    Object.entries(labelMatch).every(([key, expected]) => v.labels[key] === expected)
  );

describe('MetricsService', () => {
  beforeEach(() => {
    // Clears metric values but keeps the six metrics registered
    client.register.resetMetrics();
    jest.clearAllMocks();
  });

  describe('trackCommand', () => {
    test('increments anilist_bot_commands_total with command_type and the raw guild_id', async () => {
      metricsService.trackCommand('anime_random', 'guild-42');

      const values = await getValues('anilist_bot_commands_total');
      const entry = findValue(values, { command_type: 'anime_random', guild_id: 'guild-42' });

      expect(entry).toBeDefined();
      expect(entry.value).toBe(1);
      // Flag-only observation: guild ids are NOT hashed (unlike usernames)
    });

    test('returns an end-timer that records the given status into the duration histogram', async () => {
      const end = metricsService.trackCommand('anime_stats', 'guild-42');
      end('failure');

      const values = await getValues('anilist_bot_command_duration_seconds');
      const count = values.find(v => v.metricName === 'anilist_bot_command_duration_seconds_count');

      expect(count.labels).toEqual({ command_type: 'anime_stats', status: 'failure' });
      expect(count.value).toBe(1);
    });

    test('defaults the end-timer status to success', async () => {
      const end = metricsService.trackCommand('anime_stats', 'guild-42');
      end();

      const values = await getValues('anilist_bot_command_duration_seconds');
      const count = values.find(v => v.metricName === 'anilist_bot_command_duration_seconds_count');

      expect(count.labels).toEqual({ command_type: 'anime_stats', status: 'success' });
      expect(count.value).toBe(1);
    });

    test('returns a callable noop when counter tracking throws', () => {
      // Pins the contract app.js relies on: the end-timer is always a function
      jest.spyOn(metricsService.commandCounter, 'inc').mockImplementation(() => {
        throw new Error('registry broke');
      });

      const end = metricsService.trackCommand('anime_random', 'guild-42');

      expect(typeof end).toBe('function');
      expect(() => end('success')).not.toThrow();
    });
  });

  describe('trackApiRequest privacy contract', () => {
    test('stores only the first 12 hex chars of the sha256 of the username', async () => {
      metricsService.trackApiRequest('anime_random', 'started', 'testuser');

      const values = await getValues('anilist_api_requests_total');
      const entry = findValue(values, {
        endpoint: 'anime_random',
        status: 'started',
        username: sha256Prefix('testuser')
      });

      expect(entry).toBeDefined();
      expect(entry.value).toBe(1);
    });

    test('never exposes the raw username in labels or exposition text', async () => {
      metricsService.trackApiRequest('anime_random', 'started', 'testuser');

      const values = await getValues('anilist_api_requests_total');
      const rawHits = values.filter(v => Object.values(v.labels).includes('testuser'));
      expect(rawHits).toHaveLength(0);

      const exposition = await metricsService.getMetrics();
      expect(exposition).not.toContain('testuser');
      expect(exposition).toContain(sha256Prefix('testuser'));
    });

    test('uses "unknown" for falsy usernames', async () => {
      metricsService.trackApiRequest('anime_random', 'failure', undefined);

      const values = await getValues('anilist_api_requests_total');
      const entry = findValue(values, {
        endpoint: 'anime_random',
        status: 'failure',
        username: 'unknown'
      });

      expect(entry).toBeDefined();
    });

    test('swallows counter errors', () => {
      jest.spyOn(metricsService.apiRequestCounter, 'inc').mockImplementation(() => {
        throw new Error('registry broke');
      });

      expect(() =>
        metricsService.trackApiRequest('anime_random', 'started', 'testuser')
      ).not.toThrow();
    });
  });

  describe('updateUserStats', () => {
    test('sets the gauge with a hashed username label and the given value', async () => {
      metricsService.updateUserStats('total_anime', 'testuser', 42);

      const values = await getValues('anilist_user_stats');
      const entry = findValue(values, {
        metric_type: 'total_anime',
        username: sha256Prefix('testuser')
      });

      expect(entry).toBeDefined();
      expect(entry.value).toBe(42);
    });

    test('uses "unknown" for falsy usernames', async () => {
      metricsService.updateUserStats('total_anime', null, 7);

      const values = await getValues('anilist_user_stats');
      const entry = findValue(values, {
        metric_type: 'total_anime',
        username: 'unknown'
      });

      expect(entry).toBeDefined();
      expect(entry.value).toBe(7);
    });
  });

  describe('trackCacheHit and trackError', () => {
    test('trackCacheHit increments with the cache_type label', async () => {
      metricsService.trackCacheHit('anime_random');

      const values = await getValues('anilist_bot_cache_hits');
      const entry = findValue(values, { cache_type: 'anime_random' });

      expect(entry).toBeDefined();
      expect(entry.value).toBe(1);
    });

    test('trackError increments with error_type and command_type labels', async () => {
      metricsService.trackError('fetch_failure', 'anime_stats');

      const values = await getValues('anilist_bot_errors_total');
      const entry = findValue(values, {
        error_type: 'fetch_failure',
        command_type: 'anime_stats'
      });

      expect(entry).toBeDefined();
      expect(entry.value).toBe(1);
    });

    test('both swallow internal errors', () => {
      jest.spyOn(metricsService.cacheHitCounter, 'inc').mockImplementation(() => {
        throw new Error('registry broke');
      });
      jest.spyOn(metricsService.errorCounter, 'inc').mockImplementation(() => {
        throw new Error('registry broke');
      });

      expect(() => metricsService.trackCacheHit('anime_random')).not.toThrow();
      expect(() => metricsService.trackError('fetch_failure', 'anime_stats')).not.toThrow();
    });
  });

  describe('getMetrics', () => {
    test('returns exposition-format text containing tracked metrics', async () => {
      metricsService.trackCommand('anime_random', 'guild-42');

      const exposition = await metricsService.getMetrics();

      expect(exposition).toContain('anilist_bot_commands_total');
    });
  });
});
