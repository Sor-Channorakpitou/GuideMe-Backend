import Redis from "ioredis";

/**
 * GuideMe Redis Client
 *
 * Provides a shared ioredis instance used across three distinct caching layers:
 *   1. Session cache  — active tutorial state keyed by userId (TTL 24 h)
 *   2. Rate-limit store — per-user daily AI quota counters (TTL auto-managed by aiRateLimit)
 *   3. TTS audio cache — maps SHA-256(text:lang:speed:gender) → CDN URL (TTL 30 days)
 *
 * If REDIS_URL is absent (e.g. local dev without Redis) the client silently degrades:
 * every cache miss falls through to the primary data source. Set REDIS_DISABLED=true to
 * skip even the connection attempt (useful in CI / unit tests).
 */

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_DISABLED = process.env.REDIS_DISABLED === "true";

// ── Cache TTLs (seconds) ─────────────────────────────────────────────────────
export const REDIS_TTL = {
  /** Active tutorial session state — expires after 24 hours of inactivity */
  SESSION: 60 * 60 * 24,
  /** Per-user AI rate-limit counter — resets at midnight UTC (max 24 h) */
  AI_RATE_LIMIT: 60 * 60 * 24,
  /** TTS audio URL cache — audio files are immutable once generated */
  TTS_AUDIO: 60 * 60 * 24 * 30,
  /**
   * Generated guide-step cache — keyed by a hash of (prompt + DOM snapshot).
   * Serving the same cached result for an identical intent on an identical
   * page is what makes step generation deterministic across repeat requests,
   * not just low-temperature sampling. 24h balances that against pages whose
   * DOM meaningfully changes within a day.
   */
  GUIDE_STEPS: 60 * 60 * 24,
  /** Generic API response cache — short-lived hot path data */
  API_RESPONSE: 60 * 5,
} as const;

// ── Cache Key Namespaces ─────────────────────────────────────────────────────
export const REDIS_KEY = {
  session:      (userId: string)  => `guideme:session:${userId}`,
  aiRateLimit:  (userId: string, date: string) => `guideme:ai_rate:${userId}:${date}`,
  // Separate from aiRateLimit: TTS costs nothing extra to serve (Edge TTS is
  // free, only S3 storage + Redis are involved), so it shouldn't consume the
  // same paid-Gemini-call quota. This is an abuse-prevention cap, not a
  // cost-control one — same shape, much higher default limit.
  ttsRateLimit: (userId: string, date: string) => `guideme:tts_rate:${userId}:${date}`,
  ttsAudio:     (hash: string)    => `guideme:tts:${hash}`,
  guideSteps:   (hash: string)    => `guideme:guide_steps:${hash}`,
} as const;

// ── Client singleton ─────────────────────────────────────────────────────────
class RedisClient {
  private client: Redis | null = null;
  private _connected = false;

  constructor() {
    if (REDIS_DISABLED || !REDIS_URL) {
      console.info("[Redis] Disabled or REDIS_URL not set — running without cache layer.");
      return;
    }

    this.client = new Redis(REDIS_URL, {
      lazyConnect:          true,
      enableOfflineQueue:   false,   // fail fast instead of queuing during outage
      maxRetriesPerRequest: 1,
      connectTimeout:       3000,
      retryStrategy: (times) => {
        if (times >= 3) return null; // stop retrying after 3 attempts
        return Math.min(times * 200, 1000);
      },
    });

    this.client.on("connect",   () => { this._connected = true;  console.info("[Redis] Connected."); });
    this.client.on("close",     () => { this._connected = false; });
    this.client.on("error",     (err) => console.warn("[Redis] Error:", err.message));
    this.client.on("reconnecting", () => console.info("[Redis] Reconnecting..."));

    this.client.connect().catch((err) => {
      console.warn("[Redis] Initial connection failed — cache disabled:", err.message);
    });
  }

  get isConnected(): boolean { return this._connected; }

  /** Get a string value. Returns null on miss or when Redis is unavailable. */
  async get(key: string): Promise<string | null> {
    if (!this.client || !this._connected) return null;
    try { return await this.client.get(key); }
    catch { return null; }
  }

  /** Set a string value with an optional TTL in seconds. */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client || !this._connected) return;
    try {
      if (ttlSeconds) await this.client.set(key, value, "EX", ttlSeconds);
      else            await this.client.set(key, value);
    } catch { /* silent — cache is best-effort */ }
  }

  /** Get a parsed JSON object. Returns null on miss, parse error, or unavailability. */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; }
    catch { return null; }
  }

  /** Serialize an object to JSON and store it with an optional TTL. */
  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try { await this.set(key, JSON.stringify(value), ttlSeconds); }
    catch { /* silent */ }
  }

  /**
   * Increment a counter and set TTL only if it was just created (atomic).
   * Returns `null` — never `0` — when Redis is unavailable or the pipeline
   * itself fails, so callers can distinguish "the count is genuinely zero"
   * from "we couldn't talk to Redis" and avoid persisting a bogus zero.
   */
  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number | null> {
    if (!this.client || !this._connected) return null;
    try {
      const pipeline = this.client.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, ttlSeconds, "NX"); // set TTL only on first increment
      const results = await pipeline.exec();
      if (!results) return null;
      const [incrErr, incrValue] = results[0] || [];
      if (incrErr || typeof incrValue !== "number") return null;
      return incrValue;
    } catch { return null; }
  }

  /** Delete a key. */
  async del(key: string): Promise<void> {
    if (!this.client || !this._connected) return;
    try { await this.client.del(key); }
    catch { /* silent */ }
  }

  /** Check whether a key exists. */
  async exists(key: string): Promise<boolean> {
    if (!this.client || !this._connected) return false;
    try { return (await this.client.exists(key)) === 1; }
    catch { return false; }
  }
}

export const redis = new RedisClient();
export default redis;
