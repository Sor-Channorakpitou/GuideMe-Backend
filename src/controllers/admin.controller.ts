import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import prisma from "../config/db.js";
import * as billingService from "../services/billing.service.js";

/**
 * Admin-only manual plan grant — this is how a Business (ENTERPRISE) upgrade
 * actually happens after a sales deal closes (see /api/support/sales-lead
 * for the inbound lead). Not reachable by a regular user's own token; the
 * self-serve /api/billing/change-plan endpoint only ever allows FREE/PRO.
 */
export async function setUserPlan(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = req.params;
    const { plan } = req.body;

    const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!targetUser) {
      res.status(404).json({ error: { message: "User not found", code: "NOT_FOUND" } });
      return;
    }

    const billing = await billingService.changePlan(userId, plan);

    // Audit trail — who granted it, and record it as a real billing event
    // (amount 0 since this is a manually-negotiated deal, not a card charge).
    await prisma.billingHistory.create({
      data: {
        userId,
        plan,
        amount: 0,
        status: `manual-grant-by-${req.userId}`,
      },
    });

    res.json(billing);
  } catch (err) {
    next(err);
  }
}
