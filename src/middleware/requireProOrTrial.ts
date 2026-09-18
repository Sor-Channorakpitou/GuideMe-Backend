import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import prisma from "../config/db.js";

/**
 * AI Chat / dynamic-guidance gate — per the approved revenue model, FREE
 * gets pre-built guides only ("Standard click beacons", no AI chat/live
 * overlays); PRO+ unlocks unlimited dynamic AI guidance. FREE users get a
 * small number of one-time lifetime tries (not a daily allowance) so they
 * can actually see the AI feature before deciding to upgrade.
 *
 * Must run AFTER `auth`. Applies to every AI-calling route (assistant-chat,
 * validate-intent, intent-rerank, dom-guide, generate-steps, generate-
 * guide) — gating only the "final" action would let a FREE user burn real
 * LLM cost on preparatory calls that were always going to be blocked at the
 * last step anyway.
 */
const FREE_TRIAL_LIMIT = 3;

export async function requireProOrTrial(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: { message: "No token provided", code: "UNAUTHORIZED" } });
    return;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { plan: true, aiTrialUsed: true },
    });

    if (!user) {
      res.status(401).json({ error: { message: "User not found", code: "UNAUTHORIZED" } });
      return;
    }

    if (user.plan === "PRO" || user.plan === "ENTERPRISE") {
      next();
      return;
    }

    // FREE plan
    if (user.aiTrialUsed >= FREE_TRIAL_LIMIT) {
      res.status(403).json({
        error: {
          message: "You've used your free AI guidance trials. Upgrade to PRO for unlimited AI guidance.",
          messageKm: "អ្នកបានប្រើសាកល្បង AI ដោយឥតគិតថ្លៃអស់ហើយ។ សូមដំឡើងទៅ PRO ដើម្បីទទួលបានការណែនាំ AI គ្មានដែនកំណត់។",
          code: "PRO_REQUIRED",
          trialLimit: FREE_TRIAL_LIMIT,
        },
      });
      return;
    }

    // Consume one trial credit and proceed. Fire-and-forget is deliberately
    // NOT used here — we want the increment to have actually happened before
    // the (possibly expensive) AI call runs, so a crashed/retried request
    // can't double-dip past the limit via a race.
    await prisma.user.update({
      where: { id: req.userId },
      data: { aiTrialUsed: { increment: 1 } },
    });

    next();
  } catch (err) {
    next(err);
  }
}
