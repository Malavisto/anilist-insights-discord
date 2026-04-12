/**
 * Generic caching service with TTL (time-to-live) support
 * Used across multiple modules for performance optimization
 */
class CacheService {
    constructor(ttl = 300000) { // 5 minutes default TTL
        this.cache = new Map();
        this.ttl = ttl;
    }

    set(key, value) {
        const entry = {
            value,
            timestamp: Date.now()
        };
        this.cache.set(key, entry);
        return value;
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check if entry is expired
        if (Date.now() - entry.timestamp > this.ttl) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    clear(key) {
        this.cache.delete(key);
    }

    clearAll() {
        this.cache.clear();
    }
}

module.exports = CacheService;
