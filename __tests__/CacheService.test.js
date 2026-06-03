/**
 * Tests for CacheService - core caching functionality
 */
const CacheService = require('../modules/CacheService');
const logger = require('../logger');

jest.useFakeTimers();

describe('CacheService', () => {
  let cache;

  beforeEach(() => {
    cache = new CacheService(300000, 'TestCache', 60000);
    jest.clearAllMocks();
  });

  afterEach(() => {
    cache.clearAll();
  });

  // Constructor Tests
  describe('constructor', () => {
    test('initializes with default TTL of 300000ms', () => {
      const testCache = new CacheService();
      expect(testCache.ttl).toBe(300000);
      expect(testCache.name).toBe('Default');
      expect(testCache.sweepInterval).toBe(60000);
    });

    test('initializes with custom TTL and name', () => {
      const testCache = new CacheService(600000, 'CustomCache');
      expect(testCache.ttl).toBe(600000);
      expect(testCache.name).toBe('CustomCache');
    });

    test('initializes empty cache and stats', () => {
      expect(cache.cache.size).toBe(0);
      expect(cache.stats.hits).toBe(0);
      expect(cache.stats.misses).toBe(0);
      expect(cache.stats.evictions).toBe(0);
      expect(cache.stats.sets).toBe(0);
    });
  });

  // Set and Get Tests
  describe('set and get', () => {
    test('set() stores a value and increments sets counter', () => {
      const result = cache.set('key1', 'value1');
      expect(result).toBe('value1');
      expect(cache.stats.sets).toBe(1);
      expect(cache.cache.size).toBe(1);
    });

    test('get() returns cached value within TTL', () => {
      cache.set('key1', 'value1');
      const result = cache.get('key1');
      expect(result).toBe('value1');
      expect(cache.stats.hits).toBe(1);
    });

    test('get() increments misses for missing keys', () => {
      const result = cache.get('nonexistent');
      expect(result).toBeNull();
      expect(cache.stats.misses).toBe(1);
    });

    test('get() returns null and increments misses for expired entries', () => {
      cache.set('key1', 'value1');
      expect(cache.stats.sets).toBe(1);

      // Advance time past TTL
      jest.advanceTimersByTime(300001);

      const result = cache.get('key1');
      expect(result).toBeNull();
      expect(cache.stats.misses).toBe(1);
      expect(cache.stats.evictions).toBe(1);
    });

    test('get() removes expired entry from cache', () => {
      cache.set('key1', 'value1');
      expect(cache.cache.size).toBe(1);

      jest.advanceTimersByTime(300001);
      cache.get('key1');

      expect(cache.cache.size).toBe(0);
    });

    test('multiple sets and gets work correctly', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      expect(cache.cache.size).toBe(3);
      expect(cache.stats.sets).toBe(3);

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
      expect(cache.stats.hits).toBe(3);
    });

    test('overwriting a key updates the timestamp', () => {
      cache.set('key1', 'value1');
      jest.advanceTimersByTime(150000); // Half TTL

      cache.set('key1', 'value1_updated');
      jest.advanceTimersByTime(150001); // Another half + 1ms

      // Should still be in cache because timestamp was reset
      const result = cache.get('key1');
      expect(result).toBe('value1_updated');
      expect(cache.stats.hits).toBe(1);
    });
  });

  // Clear Tests
  describe('clear', () => {
    test('clear() removes specific key', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear('key1');

      expect(cache.cache.size).toBe(1);
      expect(cache.get('key1')).toBeNull();
      expect(cache.get('key2')).toBe('value2');
    });

    test('clear() does not affect stats', () => {
      cache.set('key1', 'value1');
      const initialSets = cache.stats.sets;

      cache.clear('key1');

      expect(cache.stats.sets).toBe(initialSets);
    });

    test('clearAll() removes all entries and resets stats', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.get('key1'); // Hit
      cache.get('key3'); // Miss

      expect(cache.cache.size).toBe(2);
      expect(cache.stats.hits).toBe(1);
      expect(cache.stats.misses).toBe(1);

      cache.clearAll();

      expect(cache.cache.size).toBe(0);
      expect(cache.stats.hits).toBe(0);
      expect(cache.stats.misses).toBe(0);
      expect(cache.stats.sets).toBe(0);
    });
  });

  // Statistics Tests
  describe('statistics', () => {
    test('getHitRatio() returns 0 when no accesses', () => {
      const ratio = cache.getHitRatio();
      expect(ratio).toBe(0);
    });

    test('getHitRatio() calculates correctly', () => {
      cache.set('key1', 'value1');
      cache.get('key1'); // 1 hit
      cache.get('key2'); // 1 miss
      cache.get('key1'); // 1 hit

      const ratio = cache.getHitRatio();
      expect(ratio).toBe(67); // 2 hits out of 3 total (rounded)
    });

    test('getStats() returns complete statistics object', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.get('key1'); // Hit
      cache.get('key3'); // Miss

      const stats = cache.getStats();

      expect(stats).toHaveProperty('name', 'TestCache');
      expect(stats).toHaveProperty('totalKeys', 2);
      expect(stats).toHaveProperty('hits', 1);
      expect(stats).toHaveProperty('misses', 1);
      expect(stats).toHaveProperty('sets', 2);
      expect(stats).toHaveProperty('evictions', 0);
      expect(stats).toHaveProperty('hitRatio');
      expect(stats).toHaveProperty('memoryEstimate');
    });

    test('getStats() reflects evictions', () => {
      cache.set('key1', 'value1');
      jest.advanceTimersByTime(300001);
      cache.get('key1'); // Should evict

      const stats = cache.getStats();
      expect(stats.evictions).toBe(1);
    });
  });

  // Edge Cases
  describe('edge cases', () => {
    test('handles null values', () => {
      cache.set('nullKey', null);
      expect(cache.get('nullKey')).toBeNull();
      // Note: This is an edge case - null values can't be distinguished from cache misses
    });

    test('handles undefined values', () => {
      cache.set('undefKey', undefined);
      expect(cache.get('undefKey')).toBeUndefined();
    });

    test('handles empty string keys', () => {
      cache.set('', 'emptyKeyValue');
      expect(cache.get('')).toBe('emptyKeyValue');
    });

    test('handles empty string values', () => {
      cache.set('key1', '');
      expect(cache.get('key1')).toBe('');
    });

    test('handles complex objects as values', () => {
      const obj = { id: 1, name: 'test', nested: { data: [1, 2, 3] } };
      cache.set('objKey', obj);
      expect(cache.get('objKey')).toEqual(obj);
    });

    test('handles arrays as values', () => {
      const arr = [1, 2, 3, 'test', { nested: true }];
      cache.set('arrKey', arr);
      expect(cache.get('arrKey')).toEqual(arr);
    });

    test('TTL of 0 immediately expires entries', () => {
      const zeroTtlCache = new CacheService(0, 'ZeroTTL');
      zeroTtlCache.set('key1', 'value1');
      jest.advanceTimersByTime(1);

      const result = zeroTtlCache.get('key1');
      expect(result).toBeNull();
    });
  });

  // Sweep Tests
  describe('sweep mechanism', () => {
    test('sweepExpired() removes expired entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      jest.advanceTimersByTime(300001);
      cache.sweepExpired();

      expect(cache.cache.size).toBe(0);
      expect(cache.stats.evictions).toBe(2);
    });

    test('sweepExpired() keeps non-expired entries', () => {
      cache.set('key1', 'value1');
      jest.advanceTimersByTime(150000); // Half TTL
      cache.set('key2', 'value2');

      jest.advanceTimersByTime(150001);
      cache.sweepExpired(); // key1 should be expired, key2 should not

      expect(cache.cache.size).toBe(1);
      expect(cache.get('key2')).toBe('value2');
    });
  });

  // Memory Estimation Tests
  describe('memory estimation', () => {
    test('estimateMemory() returns a positive number', () => {
      cache.set('key1', 'value1');
      const estimate = cache.estimateMemory();
      expect(estimate).toBeGreaterThan(0);
    });

    test('estimateMemory() increases with more entries', () => {
      cache.set('key1', 'small');
      const estimate1 = cache.estimateMemory();

      cache.set('key2', 'a'.repeat(1000));
      const estimate2 = cache.estimateMemory();

      expect(estimate2).toBeGreaterThan(estimate1);
    });

    test('estimateMemory() decreases after clearing', () => {
      cache.set('key1', 'a'.repeat(1000));
      const estimate1 = cache.estimateMemory();

      cache.clear('key1');
      const estimate2 = cache.estimateMemory();

      expect(estimate2).toBeLessThan(estimate1);
    });
  });

  // Concurrency/Stress Tests
  describe('stress tests', () => {
    test('handles many cache entries', () => {
      for (let i = 0; i < 1000; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      expect(cache.cache.size).toBe(1000);
      expect(cache.get('key0')).toBe('value0');
      expect(cache.get('key999')).toBe('value999');
    });

    test('maintains correct statistics with many operations', () => {
      for (let i = 0; i < 100; i++) {
        cache.set(`key${i}`, `value${i}`);
      }

      for (let i = 0; i < 50; i++) {
        cache.get(`key${i}`); // Hit
      }

      for (let i = 0; i < 50; i++) {
        cache.get(`missing${i}`); // Miss
      }

      expect(cache.stats.sets).toBe(100);
      expect(cache.stats.hits).toBe(50);
      expect(cache.stats.misses).toBe(50);
      expect(cache.getHitRatio()).toBe(50);
    });
  });
});
