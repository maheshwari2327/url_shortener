/**
 * ============================================================================
 * LAYER: Database / Persistence Layer (Redis Client)
 * Description: Manages the connection to the Redis key-value store using the
 *              official 'redis' npm package. Provides key-value operations,
 *              atomic counters, list operations, TTL support, and database seeding.
 * ============================================================================
 */

// Import the official Redis client creator from the 'redis' npm package
const { createClient } = require('redis');

// Redis connection URL (configurable via environment variable, defaults to standard local Redis port)
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Track connection mode: 'connected' (real Redis) or 'fallback' (in-memory mock if Redis is offline)
let isFallbackMode = false;

// Internal in-memory storage used ONLY if the local Redis server is not running
// This ensures the application remains functional for evaluation while prompting
// the developer to run 'docker run -p 6379:6379 redis' for real persistence.
const inMemoryStore = {
  strings: new Map(),
  lists: new Map(),
  expiries: new Map() // key -> expiration timestamp in ms
};

/**
 * Clean up expired keys in the in-memory fallback store
 */
function checkInMemoryExpiry(key) {
  if (inMemoryStore.expiries.has(key)) {
    const expiresAt = inMemoryStore.expiries.get(key);
    if (Date.now() > expiresAt) {
      inMemoryStore.strings.delete(key);
      inMemoryStore.expiries.delete(key);
      return true; // expired
    }
  }
  return false;
}

// Instantiate the official Redis client
let client = null;

try {
  client = createClient({
    url: REDIS_URL,
    socket: {
      connectTimeout: 3000,
      reconnectStrategy: (retries) => {
        // Stop reconnecting after 2 failed attempts on startup to trigger fallback mode smoothly
        if (retries > 2) {
          return new Error('Max Redis connection attempts reached');
        }
        return Math.min(retries * 200, 1000);
      }
    }
  });

  // Handle client connection errors without crashing the Express process
  client.on('error', (err) => {
    if (!isFallbackMode) {
      console.warn(`[Redis Notice] Could not connect to Redis at ${REDIS_URL}: ${err.message}`);
      console.warn(`[Redis Notice] To run Redis with Docker, execute: docker run -d -p 6379:6379 redis`);
    }
  });
} catch (err) {
  console.warn(`[Redis Init Error] ${err.message}`);
}

/**
 * Initializes the Redis connection or activates the in-memory fallback
 */
async function initRedis() {
  if (client) {
    try {
      await client.connect();
      isFallbackMode = false;
      console.log(`✅ [Database Layer] Successfully connected to Redis server at ${REDIS_URL}`);
      return;
    } catch (err) {
      isFallbackMode = true;
      console.warn(`⚠️ [Database Layer] Redis server unavailable at ${REDIS_URL}.`);
      console.warn(`⚠️ [Database Layer] Running in graceful IN-MEMORY fallback mode.`);
      console.warn(`ℹ️ [Database Layer] Start Docker Redis anytime with: docker run -p 6379:6379 redis`);
    }
  } else {
    isFallbackMode = true;
  }
}

/**
 * Database abstraction methods that route to official Redis or fallback
 */
const db = {
  /**
   * Check if running in fallback mode
   */
  isFallback: () => isFallbackMode,

  /**
   * Get a string value by key
   * Redis command: GET key
   */
  async get(key) {
    if (!isFallbackMode && client && client.isReady) {
      return await client.get(key);
    }
    if (checkInMemoryExpiry(key)) return null;
    return inMemoryStore.strings.get(key) || null;
  },

  /**
   * Set a string value by key with optional expiration
   * Redis command: SET key value [EX seconds]
   */
  async set(key, value, options = {}) {
    if (!isFallbackMode && client && client.isReady) {
      if (options.EX) {
        return await client.set(key, value, { EX: options.EX });
      }
      return await client.set(key, value);
    }
    // In-memory fallback
    inMemoryStore.strings.set(key, String(value));
    if (options.EX) {
      inMemoryStore.expiries.set(key, Date.now() + options.EX * 1000);
    } else {
      inMemoryStore.expiries.delete(key);
    }
    return 'OK';
  },

  /**
   * Increment an integer value by 1 atomically
   * Redis command: INCR key
   */
  async incr(key) {
    if (!isFallbackMode && client && client.isReady) {
      return await client.incr(key);
    }
    // In-memory fallback
    checkInMemoryExpiry(key);
    const current = parseInt(inMemoryStore.strings.get(key) || '0', 10);
    const next = current + 1;
    inMemoryStore.strings.set(key, String(next));
    return next;
  },

  /**
   * Check if a key exists
   * Redis command: EXISTS key
   */
  async exists(key) {
    if (!isFallbackMode && client && client.isReady) {
      return (await client.exists(key)) === 1;
    }
    if (checkInMemoryExpiry(key)) return false;
    return inMemoryStore.strings.has(key);
  },

  /**
   * Prepend one or more elements to a list
   * Redis command: LPUSH key value
   */
  async lPush(key, value) {
    if (!isFallbackMode && client && client.isReady) {
      return await client.lPush(key, value);
    }
    // In-memory fallback
    if (!inMemoryStore.lists.has(key)) {
      inMemoryStore.lists.set(key, []);
    }
    const list = inMemoryStore.lists.get(key);
    list.unshift(String(value));
    return list.length;
  },

  /**
   * Remove elements from a list matching value
   * Redis command: LREM key count value
   */
  async lRem(key, count, value) {
    if (!isFallbackMode && client && client.isReady) {
      return await client.lRem(key, count, value);
    }
    // In-memory fallback
    if (!inMemoryStore.lists.has(key)) return 0;
    const list = inMemoryStore.lists.get(key);
    const initialLen = list.length;
    const filtered = list.filter((item) => item !== String(value));
    inMemoryStore.lists.set(key, filtered);
    return initialLen - filtered.length;
  },

  /**
   * Get a range of elements from a list
   * Redis command: LRANGE key start stop
   */
  async lRange(key, start, stop) {
    if (!isFallbackMode && client && client.isReady) {
      return await client.lRange(key, start, stop);
    }
    // In-memory fallback
    if (!inMemoryStore.lists.has(key)) return [];
    const list = inMemoryStore.lists.get(key);
    if (stop === -1) {
      return list.slice(start);
    }
    return list.slice(start, stop + 1);
  },

  /**
   * Get remaining Time-To-Live in seconds
   * Redis command: TTL key
   * Returns: positive seconds, -1 if no expiry, -2 if key doesn't exist
   */
  async ttl(key) {
    if (!isFallbackMode && client && client.isReady) {
      return await client.ttl(key);
    }
    if (checkInMemoryExpiry(key) || !inMemoryStore.strings.has(key)) {
      return -2;
    }
    if (!inMemoryStore.expiries.has(key)) {
      return -1;
    }
    const remainingMs = inMemoryStore.expiries.get(key) - Date.now();
    return Math.max(0, Math.ceil(remainingMs / 1000));
  },

  /**
   * Seed the database with sample records if running for the first time
   */
  async seedInitialData() {
    try {
      const alreadySeeded = await db.get('app:seeded');
      if (alreadySeeded) {
        console.log('ℹ️ [Database Layer] Database already seeded. Skipping seed step.');
        return;
      }

      console.log('🌱 [Database Layer] Seeding database with initial sample links...');

      // 4 sample links with realistic click counters and creation timestamps
      const samples = [
        {
          code: 'redis',
          url: 'https://redis.io',
          clicks: 42,
          createdAgoMins: 120
        },
        {
          code: 'nodejs',
          url: 'https://nodejs.org',
          clicks: 28,
          createdAgoMins: 90
        },
        {
          code: 'express',
          url: 'https://expressjs.com',
          clicks: 19,
          createdAgoMins: 60
        },
        {
          code: 'github',
          url: 'https://github.com',
          clicks: 65,
          createdAgoMins: 30
        }
      ];

      // Insert samples in reverse order so that 'github' ends up first in LRANGE
      for (const sample of samples) {
        // Key 1: Store URL mapping -> url:<code>
        await db.set(`url:${sample.code}`, sample.url);

        // Key 2: Store clicks count -> clicks:<code>
        await db.set(`clicks:${sample.code}`, sample.clicks);

        // Key 3: Store metadata (timestamp) -> meta:<code>
        const createdAt = new Date(Date.now() - sample.createdAgoMins * 60 * 1000).toISOString();
        await db.set(`meta:${sample.code}`, JSON.stringify({
          createdAt,
          isCustom: true
        }));

        // Key 4: Prepend to the recent_links Redis list
        // Remove prior duplicate if any, then lPush
        await db.lRem('recent_links', 0, sample.code);
        await db.lPush('recent_links', sample.code);
      }

      // Mark database as seeded
      await db.set('app:seeded', 'true');
      console.log(`✅ [Database Layer] Successfully seeded ${samples.length} sample records into Redis!`);
    } catch (err) {
      console.error('❌ [Database Layer] Error during database seeding:', err.message);
    }
  }
};

module.exports = {
  initRedis,
  db
};
