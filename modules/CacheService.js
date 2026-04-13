/**
 * Generic caching service with TTL (time-to-live) support
 * Used across multiple modules for performance optimization
 */
const logger = require('../logger');

class CacheService {
    constructor(ttl = 300000, name = 'Default', sweepInterval = 60000) { // 5 minutes default TTL, 1 minute sweep interval
        this.cache = new Map();
        this.ttl = ttl;
        this.name = name;
        this.sweepInterval = sweepInterval;
        this.sweepTimer = null;

        // Statistics tracking
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            sets: 0
        };

        // Start background sweep timer
        this.startSweep();
    }

    set(key, value) {
        const entry = {
            value,
            timestamp: Date.now()
        };
        this.cache.set(key, entry);
        this.stats.sets++;
        logger.debug(`[Cache:${this.name}] SET: ${key} (Total keys: ${this.cache.size})`);

        // Opportunistic cleanup
        this.sweepExpired();

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
            this.stats.misses++;
            logger.debug(`[Cache:${this.name}] EXPIRED: ${key} (TTL: ${this.ttl}ms)`);
            return null;
        }

        // Opportunistic cleanup
        this.sweepExpired();

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

    /**
     * Sweep expired entries from the cache
     */
    sweepExpired() {
        const now = Date.now();
        let evictedCount = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.ttl) {
                this.cache.delete(key);
                this.stats.evictions++;
                evictedCount++;
            }
        }

        if (evictedCount > 0) {
            logger.debug(`[Cache:${this.name}] SWEEP: Evicted ${evictedCount} expired entries (Remaining: ${this.cache.size})`);
        }
    }

    /**
     * Start the background sweep timer
     */
    startSweep() {
        if (this.sweepTimer) {
            return; // Already running
        }

        this.sweepTimer = setInterval(() => {
            this.sweepExpired();
        }, this.sweepInterval);

        // Allow Node.js to exit even if timer is active
        if (this.sweepTimer.unref) {
            this.sweepTimer.unref();
        }

        logger.debug(`[Cache:${this.name}] SWEEP: Started background sweep (interval: ${this.sweepInterval}ms)`);
    }

    /**
     * Stop the background sweep timer and cleanup
     */
    destroy() {
        if (this.sweepTimer) {
            clearInterval(this.sweepTimer);
            this.sweepTimer = null;
            logger.debug(`[Cache:${this.name}] SWEEP: Stopped background sweep`);
        }
    }
}

module.exports = CacheService;