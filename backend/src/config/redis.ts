import Redis from 'ioredis';

let redis: Redis | null = null;
let redisEnabled = false;

export async function connectRedis(): Promise<boolean> {
  if (process.env.REDIS_ENABLED === 'false') {
    console.log('⏭️  Redis disabled (REDIS_ENABLED=false)');
    return false;
  }
  try {
    const opts: Record<string, unknown> = {
      connectTimeout: 3000,
      retryStrategy: () => null,
    };
    if (process.env.REDIS_URL) {
      redis = new Redis(process.env.REDIS_URL, opts);
    } else {
      redis = new Redis({
        ...opts,
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB || '0'),
      });
    }

    // Prevent unhandled error events from crashing the process
    redis.on('error', (err) => {
      console.warn('⚠️  Redis error:', err.message);
      if (redisEnabled) {
        redisEnabled = false;
        redis?.disconnect();
        redis = null;
        console.log('⏭️  Redis disconnected, continuing without cache');
      }
    });

    await redis.ping();
    redisEnabled = true;
    console.log('✅ Redis connected');
    return true;
  } catch (_err) {
    console.log('⏭️  Redis not available, continuing without cache');
    if (redis) {
      redis.disconnect();
      redis = null;
    }
    return false;
  }
}

export function getRedis(): Redis | null {
  return redis;
}

export function isRedisEnabled(): boolean {
  return redisEnabled;
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    redisEnabled = false;
  }
}
