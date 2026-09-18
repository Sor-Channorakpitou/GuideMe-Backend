import { Router } from "express";
import { body } from "express-validator";
import { auth } from "../middleware/auth.js";
import { requirePaidPlan } from "../middleware/requirePaidPlan.js";
import { ttsRateLimit } from "../middleware/ttsRateLimit.js";
import { validate } from "../middleware/validate.js";
import * as ttsCtrl from "../controllers/tts.controller.js";

const router = Router();

const ttsValidation = [
  body("text").isString().trim().notEmpty().isLength({ max: 2000 }),
  body("language").optional().isIn(["km", "en"]),
  body("speed").optional().isIn(["slow", "normal", "fast"]),
  body("voiceGender").optional().isIn(["female", "male"]),
  validate,
];

// ── Khmer / English TTS Voice Synthesis (/api/tts & /api/v1/tts) ──
router.post("/", auth, requirePaidPlan, ttsRateLimit, ttsValidation, ttsCtrl.synthesize);
router.post("/synthesize", auth, requirePaidPlan, ttsRateLimit, ttsValidation, ttsCtrl.synthesize);

export default router;
