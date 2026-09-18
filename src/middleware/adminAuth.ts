import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth.js";
import prisma from "../config/db.js";

/**
 * Requires the authenticated user to have role === "ADMIN". Must run AFTER
 * `auth` (needs req.userId already set). Used for actions that shouldn't be
 * reachable by a regular account at all — e.g. moderating any user's guide,
 * or manually granting a plan upgrade after a sales deal closes.
 */
export async function adminAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  if (!req.userId) {
    res.status(401).json({ error: { message: "No token provided", code: "UNAUTHORIZED" } });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } });
    if (!user || user.role !== "ADMIN") {
      res.status(403).json({ error: { message: "Admin access required", code: "FORBIDDEN" } });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
