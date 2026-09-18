import { Router } from "express";
import { body } from "express-validator";
import { validate } from "../middleware/validate.js";
import * as ctrl from "../controllers/support.controller.js";

const router = Router();

/**
 * @openapi
 * /api/support/contact:
 *   post:
 *     tags: [Support]
 *     summary: Submit a support ticket (no auth required)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, subject, message]
 *             properties:
 *               category: { type: string, enum: [Technical, Billing, Subscription, Usage, Other] }
 *               subject:  { type: string }
 *               message:  { type: string }
 *               name:     { type: string, description: "Required for unauthenticated users" }
 *               email:    { type: string, description: "Required for unauthenticated users" }
 *     responses:
 *       201:
 *         description: Ticket submitted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/SupportTicket"
 */
router.post("/contact", [
  body("category").notEmpty(),
  body("subject").notEmpty(),
  body("message").notEmpty(),
  body("name").optional(),
  body("email").optional().isEmail(),
  validate,
], ctrl.submitContact);

/**
 * @openapi
 * /api/support/sales-lead:
 *   post:
 *     tags: [Support]
 *     summary: Submit a Business (Enterprise) plan sales inquiry (no auth required).
 *       Creates a support ticket tagged "sales" and emails the team — Business
 *       plan upgrades are sales-assisted, not self-serve (see /api/billing/change-plan).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, message]
 *             properties:
 *               name:    { type: string }
 *               email:   { type: string }
 *               company: { type: string }
 *               message: { type: string }
 *     responses:
 *       201:
 *         description: Lead submitted
 */
router.post("/sales-lead", [
  body("name").notEmpty(),
  body("email").isEmail(),
  body("company").optional(),
  body("message").notEmpty(),
  validate,
], ctrl.submitSalesLead);

/**
 * @openapi
 * /api/support/faq:
 *   get:
 *     tags: [Support]
 *     summary: Get FAQ data
 *     responses:
 *       200:
 *         description: FAQ list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   category: { type: string }
 *                   question: { type: string }
 *                   answer:   { type: string }
 */
router.get("/faq", ctrl.getFaq);

export default router;