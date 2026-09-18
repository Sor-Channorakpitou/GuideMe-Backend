import { Router } from "express";
import { body } from "express-validator";
import { validate } from "../middleware/validate.js";
import { auth } from "../middleware/auth.js";
import * as ctrl from "../controllers/billing.controller.js";

const router = Router();
router.use(auth);

/**
 * @openapi
 * /api/billing/current-plan:
 *   get:
 *     tags: [Billing]
 *     summary: Get current subscription plan
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current billing info
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/BillingPlan"
 */
router.get("/current-plan", ctrl.getCurrentPlan);

/**
 * @openapi
 * /api/billing/history:
 *   get:
 *     tags: [Billing]
 *     summary: Get billing history
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Billing history list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/BillingHistoryEntry"
 */
router.get("/history", ctrl.getBillingHistory);

/**
 * @openapi
 * /api/billing/change-plan:
 *   post:
 *     tags: [Billing]
 *     summary: Self-serve upgrade to PRO or downgrade to FREE. Business
 *       (ENTERPRISE) is sales-assisted only — see /api/support/sales-lead
 *       and the admin-only /api/admin/users/:userId/plan endpoint.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [plan]
 *             properties:
 *               plan: { type: string, enum: [FREE, PRO] }
 *     responses:
 *       200:
 *         description: Plan changed
 */
router.post("/change-plan", [
  body("plan").isIn(["FREE", "PRO"]),
  validate,
], ctrl.changePlan);

/**
 * @openapi
 * /api/billing/cancel:
 *   post:
 *     tags: [Billing]
 *     summary: Cancel subscription
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Subscription canceled
 */
router.post("/cancel", ctrl.cancelSubscription);

/**
 * @openapi
 * /api/billing/payment-methods:
 *   get:
 *     tags: [Billing]
 *     summary: Get saved payment methods
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Saved payment methods
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/PaymentMethod"
 */
router.get("/payment-methods", ctrl.getPaymentMethods);

/**
 * @openapi
 * /api/billing/update-payment-method:
 *   post:
 *     tags: [Billing]
 *     summary: Add or update default payment method
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, last4, expMonth, expYear]
 *             properties:
 *               type:     { type: string, example: visa }
 *               last4:    { type: string, example: "4242" }
 *               expMonth: { type: integer, example: 12 }
 *               expYear:  { type: integer, example: 2028 }
 *     responses:
 *       200:
 *         description: Payment method updated
 */
router.post("/update-payment-method", [
  body("type").notEmpty(),
  body("last4").isLength({ min: 4, max: 4 }),
  body("expMonth").isInt({ min: 1, max: 12 }),
  body("expYear").isInt({ min: 2024 }),
  validate,
], ctrl.updatePaymentMethod);

/**
 * @openapi
 * /api/billing/create-intent:
 *   post:
 *     tags: [Payment]
 *     summary: Create a payment intent
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment intent created
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 clientSecret: { type: string }
 */
router.post("/create-intent", ctrl.createPaymentIntent);

/**
 * @openapi
 * /api/billing/confirm:
 *   post:
 *     tags: [Payment]
 *     summary: Confirm payment
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment confirmed
 */
router.post("/confirm", ctrl.confirmPayment);

/**
 * @openapi
 * /api/billing/paypal/order:
 *   post:
 *     tags: [Payment]
 *     summary: Create PayPal order
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: PayPal order created, returns approval URL
 */
router.post("/paypal/order", ctrl.createPayPalOrder);

/**
 * @openapi
 * /api/billing/paypal/capture:
 *   post:
 *     tags: [Payment]
 *     summary: Capture PayPal order after approval
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: PayPal order captured
 */
router.post("/paypal/capture", ctrl.capturePayPalOrder);

/**
 * @openapi
 * /api/billing/verify-payment:
 *   get:
 *     tags: [Payment]
 *     summary: Check if payment has been received
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Payment verification result
 */
router.get("/verify-payment", ctrl.verifyPayment);

export default router;