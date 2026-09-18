import { Router } from "express";
import { body, param } from "express-validator";
import { auth } from "../middleware/auth.js";
import { adminAuth } from "../middleware/adminAuth.js";
import { validate } from "../middleware/validate.js";
import * as adminCtrl from "../controllers/admin.controller.js";

const router = Router();
router.use(auth, adminAuth);

/**
 * @openapi
 * /api/admin/users/{userId}/plan:
 *   patch:
 *     tags: [Admin]
 *     summary: Manually set a user's plan (admin only) — used after a
 *       Business sales deal closes.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [plan]
 *             properties:
 *               plan: { type: string, enum: [FREE, PRO, ENTERPRISE] }
 *     responses:
 *       200:
 *         description: Plan updated
 *       403:
 *         description: Admin access required
 *       404:
 *         description: User not found
 */
router.patch(
  "/users/:userId/plan",
  [
    param("userId").isString().notEmpty(),
    body("plan").isIn(["FREE", "PRO", "ENTERPRISE"]),
    validate,
  ],
  adminCtrl.setUserPlan
);

export default router;
