import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import prisma from "../config/db.js";

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
 * aiRateLimit — per-user daily quota enforcement middleware.
 *
 * Must be placed AFTER the `auth` middleware so that `req.userId` is available.
 *
 * On every request it:
 *  1. Loads the user's current plan, aiRequestsCount, and lastAiRequestAt.
 *  2. Resets the counter if the last request was on a different calendar day (UTC).
 *  3. Rejects with 429 if the daily quota is exhausted.
 *  4. Atomically increments aiRequestsCount and sets lastAiRequestAt = now().
 *  5. Attaches `req.aiUser` so downstream controllers can read plan/usage without
 *     a second DB round-trip.
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
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        plan: true,
        aiRequestsCount: true,
        lastAiRequestAt: true,
      },
    });

    if (!user) {
      res.status(401).json({ error: { message: "User not found", code: "UNAUTHORIZED" } });
      return;
    }

    const plan  = user.plan as string;
    const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.FREE;

    // Determine whether we should reset the daily counter.
    const now      = new Date();
    const lastDate = user.lastAiRequestAt;
    const isNewDay =
      !lastDate ||
      lastDate.toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);

    const currentCount = isNewDay ? 0 : (user.aiRequestsCount ?? 0);

    // Enforce quota (skip for ENTERPRISE / -1).
    if (limit !== -1 && currentCount >= limit) {
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

    // Atomically persist the incremented counter.
    await prisma.user.update({
      where: { id: userId },
      data: {
        aiRequestsCount: isNewDay ? 1 : { increment: 1 },
        lastAiRequestAt: now,
      },
    });

    // Make user info available to controllers without a second query.
    (req as any).aiUser = {
      id:    user.id,
      plan,
      used:  currentCount + 1,
      limit,
    };

    next();
  } catch (err) {
    console.error("[aiRateLimit] DB error:", err);
    // Fail open — don't block the user if tracking itself breaks.
    next();
  }
}
