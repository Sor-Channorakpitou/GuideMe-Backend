import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import { redis, REDIS_KEY } from "../config/redis.js";

/**
 * Daily TTS synthesis cap — separate from aiRateLimit's paid-Gemini-call
 * quota. Edge TTS is free to serve (no per-call billing), so this exists
 * purely to stop scripted abuse (e.g. hammering S3 storage), not to ration a
 * costly resource. Generous by design, and the same limit regardless of
 * plan — there's no cost reason to tier it.
 */
const DAILY_TTS_LIMIT = 300;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function ttsRateLimit(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  const userId = req.userId;
  if (!userId) {
    res.status(401).json({ error: { message: "No token provided", code: "UNAUTHORIZED" } });
    return;
  }

  // Redis-only, fail open — this is an abuse cap, not a billing-critical
  // quota, so a Redis outage should never block real voice narration.
  if (!redis.isConnected) {
    next();
    return;
  }

  try {
    const today = todayUtc();
    const key = REDIS_KEY.ttsRateLimit(userId, today);
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);

    const count = await redis.incrementWithTtl(key, ttl);
    if (count !== null && count > DAILY_TTS_LIMIT) {
      res.status(429).json({
        error: {
          message: `Too many voice requests today (${DAILY_TTS_LIMIT}/day). Please try again tomorrow.`,
          code: "TTS_QUOTA_EXCEEDED",
          limit: DAILY_TTS_LIMIT,
        },
      });
      return;
    }
    next();
  } catch (err) {
    console.error("[ttsRateLimit] Error:", err);
    next();
  }
}
