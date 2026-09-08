import { Router } from "express";
import { body } from "express-validator";
import { validate } from "../middleware/validate.js";
import * as ttsCtrl from "../controllers/tts.controller.js";

const router = Router();

// ── Khmer / English TTS Voice Synthesis ──
router.post(
  "/synthesize",
  [
    body("text").isString().trim().notEmpty(),
    body("language").optional().isIn(["km", "en"]),
    body("speed").optional().isIn(["slow", "normal", "fast"]),
    body("voiceGender").optional().isIn(["female", "male"]),
    validate,
  ],
  ttsCtrl.synthesize
);

export default router;
