import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import prisma from "../config/db.js";
import { redis, REDIS_KEY, REDIS_TTL } from "../config/redis.js";

/**
 * Daily AI request limits per plan.
 * ENTERPRISE = -1 means unlimited.
 */
const PLAN_LIMITS: Record<string, number> = {
  FREE:       50,
  PRO:        500,
  ENTERPRISE: -1,
};

/**
 * Returns today's UTC date string "YYYY-MM-DD" used as the Redis key suffix.
 * Resetting at midnight UTC gives a consistent 24-hour window globally.
 */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * aiRateLimit — per-user daily quota enforcement middleware.
 *
 * Strategy:
 *   PRIMARY   → Redis atomic INCR counter (sub-millisecond, no DB round-trip)
 *   FALLBACK  → Prisma DB counter (when Redis is unavailable)
 *
 * Must be placed AFTER the `auth` middleware so that `req.userId` is available.
 */
export async function aiRateLimit(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const userId = req.userId;

  if (!userId) {
    res.status(401).json({ error: { message: "No token provided", code: "UNAUTHORIZED" } });
    return;
  }

  try {
    // ── Resolve plan ──────────────────────────────────────────────────────────
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, plan: true, aiRequestsCount: true, lastAiRequestAt: true },
    });

    if (!user) {
      res.status(401).json({ error: { message: "User not found", code: "UNAUTHORIZED" } });
      return;
    }

    const plan  = user.plan as string;
    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;

    // ENTERPRISE users are always allowed through — skip counting entirely.
    if (limit === -1) {
      (req as any).aiUser = { id: user.id, plan, used: 0, limit };
      next();
      return;
    }

    // ── Redis-first counter ───────────────────────────────────────────────────
    if (redis.isConnected) {
      const today   = todayUtc();
      const rKey    = REDIS_KEY.aiRateLimit(userId, today);
      // Seconds remaining until next UTC midnight — this is the exact TTL we
      // need so the key auto-expires at the natural day boundary.
      const now     = new Date();
      const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const ttl     = Math.ceil((midnight.getTime() - now.getTime()) / 1000);

      const newCount = await redis.incrementWithTtl(rKey, ttl);

      // `null` means Redis reported connected but the increment itself failed
      // (transient error) — fall through to the Prisma-backed path below
      // rather than trusting/persisting a bogus zero count, which would
      // silently reset the user's quota.
      if (newCount !== null) {
        if (newCount > limit) {
          res.status(429).json({
            error: {
              message: `Daily AI request limit reached (${limit}/day for ${plan} plan). Upgrade to PRO for more requests.`,
              code:    "AI_QUOTA_EXCEEDED",
              limit,
              used:    newCount - 1,
              plan,
            },
          });
          return;
        }

        // Fire-and-forget DB sync — keeps the DB accurate for analytics/billing
        // dashboards without blocking the hot path. Don't await.
        prisma.user.update({
          where: { id: userId },
          data: { aiRequestsCount: newCount, lastAiRequestAt: now },
        }).catch(() => { /* non-critical */ });

        (req as any).aiUser = { id: user.id, plan, used: newCount, limit };
        next();
        return;
      }
    }

    // ── Prisma fallback (Redis unavailable) ───────────────────────────────────
    const now      = new Date();
    const lastDate = user.lastAiRequestAt;
    const isNewDay =
      !lastDate ||
      lastDate.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);

    const currentCount = isNewDay ? 0 : (user.aiRequestsCount ?? 0);

    if (currentCount >= limit) {
      res.status(429).json({
        error: {
          message: `Daily AI request limit reached (${limit}/day for ${plan} plan). Upgrade to PRO for more requests.`,
          code:    "AI_QUOTA_EXCEEDED",
          limit,
          used:    currentCount,
          plan,
        },
      });
      return;
    }

    await prisma.user.update({
      where: { id: userId },
      data: {
        aiRequestsCount: isNewDay ? 1 : { increment: 1 },
        lastAiRequestAt: now,
      },
    });

    (req as any).aiUser = {
      id:    user.id,
      plan,
      used:  currentCount + 1,
      limit,
    };

    next();
  } catch (err) {
    console.error("[aiRateLimit] Error:", err);
    // Fail open — don't block the user if the quota check itself breaks.
    next();
  }
}
