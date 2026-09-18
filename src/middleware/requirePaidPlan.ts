import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import prisma from "../config/db.js";

/**
 * Hard PRO/ENTERPRISE gate, no trial — used for Native Khmer Voice (TTS),
 * which the revenue model lists as a straight paid unlock ("Khmer Voice
 * Coach (TTS)" under PRO, "✗" under FREE), unlike AI chat/guidance which
 * gets a limited free trial (see requireProOrTrial.ts).
 */
export async function requirePaidPlan(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: { message: "No token provided", code: "UNAUTHORIZED" } });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { plan: true } });
    if (!user) {
      res.status(401).json({ error: { message: "User not found", code: "UNAUTHORIZED" } });
      return;
    }

    if (user.plan !== "PRO" && user.plan !== "ENTERPRISE") {
      res.status(403).json({
        error: {
          message: "Voice narration is a PRO feature. Upgrade to unlock the Khmer Voice Coach.",
          messageKm: "ការអានជាសំឡេងគឺជាមុខងារ PRO ។ សូមដំឡើងគណនីរបស់អ្នកដើម្បីប្រើប្រាស់វា។",
          code: "PRO_REQUIRED",
        },
      });
      return;
    }

    next();
  } catch (err) {
    next(err);
  }
}
