const CacheService = require('../../modules/CacheService');

describe('CacheService', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheService(1000, 'TestCache', 500); // 1 second TTL for testing
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    cache.destroy();
  });

  describe('set and get operations', () => {
    test('should store and retrieve a value', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    test('should return null for non-existent key', () => {
      expect(cache.get('nonexistent')).toBeNull();
    });

    test('should handle multiple key-value pairs', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });

    test('should overwrite existing keys', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
      
      cache.set('key1', 'newvalue1');
      expect(cache.get('key1')).toBe('newvalue1');
    });

    test('should store complex objects', () => {
      const obj = { id: 1, name: 'test', data: [1, 2, 3] };
      cache.set('complex', obj);
      expect(cache.get('complex')).toEqual(obj);
    });
  });

  describe('TTL and expiration', () => {
    test('should expire entries after TTL', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');

      // Advance time beyond TTL (1000ms)
      jest.advanceTimersByTime(1001);
      expect(cache.get('key1')).toBeNull();
    });

    test('should not expire entries before TTL', () => {
      cache.set('key1', 'value1');
      
      // Advance time less than TTL
      jest.advanceTimersByTime(500);
      expect(cache.get('key1')).toBe('value1');
    });

    test('should track evictions in stats', () => {
      cache.set('key1', 'value1');
      jest.advanceTimersByTime(1001);
      cache.get('key1'); // This should trigger eviction
      
      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  describe('clear operations', () => {
    test('should clear a specific key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear('key1');
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
    });

    test('should clear all keys with clearAll', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clearAll();
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBeNull();
      expect(cache.get('key3')).toBeNull();
      expect(cache.getStats().totalKeys).toBe(0);
    });

    test('should reset stats on clearAll', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss

      cache.clearAll();
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.sets).toBe(0);
    });
  });

  describe('cache statistics', () => {
    test('should track cache hits', () => {
      cache.set('key1', 'value1');
      cache.get('key1');
      cache.get('key1');

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
    });

    test('should track cache misses', () => {
      cache.get('nonexistent');
      cache.get('another');

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });

    test('should track sets', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      const stats = cache.getStats();
      expect(stats.sets).toBe(2);
    });

    test('should calculate hit ratio correctly', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('nonexistent'); // miss

      const stats = cache.getStats();
      expect(stats.hitRatio).toBe(67); // 2 hits / 3 total = 66.67% rounds to 67%
    });

    test('should return 0 hit ratio when no requests', () => {
      const stats = cache.getStats();
      expect(stats.hitRatio).toBe(0);
    });

    test('should include cache metadata in stats', () => {
      cache.set('key1', 'value1');
      const stats = cache.getStats();

      expect(stats.name).toBe('TestCache');
      expect(stats.totalKeys).toBe(1);
      expect(stats.memoryEstimate).toBeGreaterThan(0);
    });
  });

  describe('sweep functionality', () => {
    test('should sweep expired entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      jest.advanceTimersByTime(1001);
      cache.sweepExpired();

      const stats = cache.getStats();
      expect(stats.totalKeys).toBe(0);
    });

    test('should keep non-expired entries during sweep', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      jest.advanceTimersByTime(500);
      cache.sweepExpired();

      const stats = cache.getStats();
      expect(stats.totalKeys).toBe(2);
      expect(cache.get('key1')).toBe('value1');
    });
  });

  describe('constructor options', () => {
    test('should use custom TTL', () => {
      const customCache = new CacheService(2000, 'CustomTTL');
      customCache.set('key1', 'value1');
      
      jest.advanceTimersByTime(1500);
      expect(customCache.get('key1')).toBe('value1');
      
      jest.advanceTimersByTime(600);
      expect(customCache.get('key1')).toBeNull();
      
      customCache.destroy();
    });

    test('should use custom name', () => {
      const namedCache = new CacheService(1000, 'CustomName');
      namedCache.set('key1', 'value1');
      
      const stats = namedCache.getStats();
      expect(stats.name).toBe('CustomName');
      
      namedCache.destroy();
    });
  });
});
