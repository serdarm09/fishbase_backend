const { createClient } = require('redis');
const config = require('../config');
const { logger } = require('../utils/logger');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
  }

  async connect() {
    if (this.isConnected) {
      return this.client;
    }

    if (this.isConnecting) {
      // Wait for connection to complete
      while (this.isConnecting) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return this.client;
    }

    this.isConnecting = true;

    try {
      this.client = createClient({
        url: config.redis.url,
        socket: {
          reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
        },
      });

      this.client.on('error', (err) => {
        logger.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        logger.info('✅ Connected to Redis');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        logger.warn('Redis disconnected');
        this.isConnected = false;
      });

      this.client.on('reconnecting', () => {
        logger.info('Redis reconnecting...');
      });

      await this.client.connect();
      this.isConnecting = false;
      this.isConnected = true;
      
      return this.client;
    } catch (error) {
      this.isConnecting = false;
      this.isConnected = false;
      logger.error('Failed to connect to Redis:', error);
      throw error;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.client = null;
      this.isConnected = false;
      logger.info('✅ Disconnected from Redis');
    }
  }

  async getClient() {
    if (!this.isConnected) {
      await this.connect();
    }
    return this.client;
  }

  // Cache methods
  async set(key, value, expireInSeconds) {
    try {
      const client = await this.getClient();
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      
      if (expireInSeconds) {
        return await client.setEx(key, expireInSeconds, serializedValue);
      }
      return await client.set(key, serializedValue);
    } catch (error) {
      logger.error('Redis SET error:', { key, error: error.message });
      throw error;
    }
  }

  async get(key) {
    try {
      const client = await this.getClient();
      const value = await client.get(key);
      
      if (!value) return null;
      
      // Try to parse as JSON, fallback to string
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error('Redis GET error:', { key, error: error.message });
      return null;
    }
  }

  async del(key) {
    try {
      const client = await this.getClient();
      return await client.del(key);
    } catch (error) {
      logger.error('Redis DEL error:', { key, error: error.message });
      throw error;
    }
  }

  async exists(key) {
    try {
      const client = await this.getClient();
      return await client.exists(key);
    } catch (error) {
      logger.error('Redis EXISTS error:', { key, error: error.message });
      return false;
    }
  }

  // Leaderboard methods (Sorted Sets)
  async zadd(key, score, member) {
    try {
      const client = await this.getClient();
      return await client.zAdd(key, { score, value: member });
    } catch (error) {
      logger.error('Redis ZADD error:', { key, error: error.message });
      throw error;
    }
  }

  async zrevrange(key, start, stop, withScores = false) {
    try {
      const client = await this.getClient();
      if (withScores) {
        return await client.zRevRangeWithScores(key, start, stop);
      }
      return await client.zRevRange(key, start, stop);
    } catch (error) {
      logger.error('Redis ZREVRANGE error:', { key, error: error.message });
      throw error;
    }
  }

  async zrank(key, member) {
    try {
      const client = await this.getClient();
      return await client.zRevRank(key, member);
    } catch (error) {
      logger.error('Redis ZRANK error:', { key, error: error.message });
      return null;
    }
  }

  async zrem(key, member) {
    try {
      const client = await this.getClient();
      return await client.zRem(key, member);
    } catch (error) {
      logger.error('Redis ZREM error:', { key, error: error.message });
      throw error;
    }
  }

  // Hash methods
  async hset(key, field, value) {
    try {
      const client = await this.getClient();
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : value;
      return await client.hSet(key, field, serializedValue);
    } catch (error) {
      logger.error('Redis HSET error:', { key, field, error: error.message });
      throw error;
    }
  }

  async hget(key, field) {
    try {
      const client = await this.getClient();
      const value = await client.hGet(key, field);
      
      if (!value) return null;
      
      // Try to parse as JSON, fallback to string
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    } catch (error) {
      logger.error('Redis HGET error:', { key, field, error: error.message });
      return null;
    }
  }

  async hgetall(key) {
    try {
      const client = await this.getClient();
      const hash = await client.hGetAll(key);
      
      // Parse JSON values
      const parsed = {};
      for (const [field, value] of Object.entries(hash)) {
        try {
          parsed[field] = JSON.parse(value);
        } catch {
          parsed[field] = value;
        }
      }
      
      return parsed;
    } catch (error) {
      logger.error('Redis HGETALL error:', { key, error: error.message });
      return {};
    }
  }

  async hdel(key, field) {
    try {
      const client = await this.getClient();
      return await client.hDel(key, field);
    } catch (error) {
      logger.error('Redis HDEL error:', { key, field, error: error.message });
      throw error;
    }
  }

  // Game-specific methods
  async cacheUserSession(userId, userData, ttl = config.cache.userSession) {
    return await this.set(`user:${userId}`, userData, ttl);
  }

  async getUserSession(userId) {
    return await this.get(`user:${userId}`);
  }

  async cacheMapState(mapData, ttl = config.cache.mapState) {
    return await this.set('map:state', mapData, ttl);
  }

  async getMapState() {
    return await this.get('map:state');
  }

  async updateLeaderboard(userId, score) {
    return await this.zadd('leaderboard:xp', score, userId);
  }

  async getLeaderboard(start = 0, stop = 99) {
    return await this.zrevrange('leaderboard:xp', start, stop, true);
  }

  async getUserRank(userId) {
    const rank = await this.zrank('leaderboard:xp', userId);
    return rank !== null ? rank + 1 : null;
  }

  async updateFishingLeaderboard(userId, score) {
    return await this.zadd('leaderboard:fishing', score, userId);
  }

  async getFishingLeaderboard(start = 0, stop = 19) {
    return await this.zrevrange('leaderboard:fishing', start, stop, true);
  }

  async getFishingRank(userId) {
    const rank = await this.zrank('leaderboard:fishing', userId);
    return rank !== null ? rank + 1 : null;
  }
}

const redisService = new RedisService();

// Graceful shutdown
process.on('SIGINT', async () => {
  await redisService.disconnect();
});

module.exports = {
  connectRedis: () => redisService.connect(),
  redisService
};
