/**
 * Generic caching service with TTL (time-to-live) support
 * Used across multiple modules for performance optimization
 */
const logger = require('../logger');

class CacheService {
    constructor(ttl = 300000, name = 'Default') { // 5 minutes default TTL
        this.cache = new Map();
        this.ttl = ttl;
        this.name = name;
        
        // Statistics tracking
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            sets: 0
        };
    }

    set(key, value) {
        const entry = {
            value,
            timestamp: Date.now()
        };
        this.cache.set(key, entry);
        this.stats.sets++;
        logger.debug(`[Cache:${this.name}] SET: ${key} (Total keys: ${this.cache.size})`);
        return value;
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) {
            this.stats.misses++;
            logger.debug(`[Cache:${this.name}] MISS: ${key}`);
            return null;
        }

        // Check if entry is expired
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            this.stats.evictions++;
            logger.debug(`[Cache:${this.name}] EXPIRED: ${key} (TTL: ${this.ttl}ms)`);
            return null;
        }

        this.stats.hits++;
        logger.debug(`[Cache:${this.name}] HIT: ${key} (Hit ratio: ${this.getHitRatio()}%)`);
        return entry.value;
    }

    clear(key) {
        this.cache.delete(key);
        logger.debug(`[Cache:${this.name}] CLEARED: ${key}`);
    }

    clearAll() {
        const size = this.cache.size;
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
        logger.info(`[Cache:${this.name}] CLEARED ALL: ${size} entries removed`);
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return {
            name: this.name,
            totalKeys: this.cache.size,
            hits: this.stats.hits,
            misses: this.stats.misses,
            evictions: this.stats.evictions,
            sets: this.stats.sets,
            hitRatio: this.getHitRatio(),
            memoryEstimate: this.estimateMemory()
        };
    }

    /**
     * Calculate hit ratio percentage
     */
    getHitRatio() {
        const total = this.stats.hits + this.stats.misses;
        if (total === 0) return 0;
        return Math.round((this.stats.hits / total) * 100);
    }

    /**
     * Rough estimate of cache memory usage in bytes
     */
    estimateMemory() {
        let size = 0;
        this.cache.forEach((entry, key) => {
            size += key.length * 2; // String key
            size += JSON.stringify(entry.value).length;
        });
        return size;
    }
}

module.exports = CacheService;
