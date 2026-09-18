import { Router } from "express";
import { body } from "express-validator";
import { validate } from "../middleware/validate.js";
import { verifyWebhookSignature } from "../middleware/verifyWebhookSignature.js";
import authRoutes from "./auth.routes.js";
import userRoutes from "./user.routes.js";
import guideRoutes from "./guide.routes.js";
import aiRoutes from "./ai.routes.js";
import ttsRoutes from "./tts.routes.js";
import billingRoutes from "./billing.routes.js";
import communityRoutes from "./community.routes.js";
import supportRoutes from "./support.routes.js";
import adminRoutes from "./admin.routes.js";
import * as billingCtrl from "../controllers/billing.controller.js";

const router = Router();

router.use("/auth", authRoutes);
router.use("/user", userRoutes);
router.use("/guides", guideRoutes);
router.use("/ai", aiRoutes);
router.use("/tts", ttsRoutes);
router.use("/billing", billingRoutes);
router.use("/community", communityRoutes);
router.use("/support", supportRoutes);
router.use("/admin", adminRoutes);

// Bakong webhook — no user auth (called by Bakong's server, not a logged-in
// user), but the payload must carry a valid HMAC signature (GM-001) so an
// arbitrary caller can't fabricate a "payment completed" event.
router.post(
  "/bakong-webhook",
  [
    verifyWebhookSignature("X-Bakong-Signature"),
    body("userId").isString(),
    body("transactionId").isString(),
    body("amount").isNumeric(),
    body("status").isIn(["completed", "failed"]),
    validate,
  ],
  billingCtrl.bakongWebhook
);

export default router;
