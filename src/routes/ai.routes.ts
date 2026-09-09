import { Router } from "express";
import { body } from "express-validator";
import { auth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as aiCtrl from "../controllers/ai.controller.js";

const router = Router();

// ── Auto-Step Generation Pipeline ──
router.post(
  "/generate-guide",
  auth,
  [
    body("prompt").isString().trim().notEmpty(),
    body("category").optional().isString(),
    body("language").optional().isIn(["km", "en"]),
    validate,
  ],
  aiCtrl.generateGuide
);

// ── Contextual Assistant Q&A ──
router.post(
  "/assistant-chat",
  [
    body("question").isString().trim().notEmpty(),
    body("context").optional().isObject(),
    body("language").optional().isIn(["km", "en"]),
    body("image").optional().isString(),
    validate,
  ],
  aiCtrl.askAssistant
);

// ── Two-Stage Intent Candidate Re-Ranking (Extension API Client Endpoint) ──
router.post(
  "/intent-rerank",
  [
    body("prompt").isString().trim().notEmpty(),
    body("candidates").isArray({ min: 1 }),
    validate,
  ],
  aiCtrl.rerankIntentCandidates
);

// ── Live DOM Candidate Walkthrough Synthesizer (Extension AI Agent Endpoint) ──
router.post(
  "/dom-guide",
  [
    body("prompt").isString().trim().notEmpty(),
    body("elements").isArray({ min: 1 }),
    body("url").optional().isString(),
    body("language").optional().isIn(["km", "en"]),
    validate,
  ],
  aiCtrl.generateDomGuide
);

export default router;

