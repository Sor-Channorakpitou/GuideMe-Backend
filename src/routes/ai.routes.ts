import { Router } from "express";
import { body } from "express-validator";
import { auth } from "../middleware/auth.js";
import { aiRateLimit } from "../middleware/aiRateLimit.js";
import { validate } from "../middleware/validate.js";
import * as aiCtrl from "../controllers/ai.controller.js";

const router = Router();

// ── Auto-Step Generation Pipeline ──
router.post(
  "/generate-guide",
  auth,
  aiRateLimit,
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
  auth,
  aiRateLimit,
  [
    body("question").isString().trim().notEmpty(),
    body("context").optional().isObject(),
    body("language").optional().isIn(["km", "en"]),
    body("image").optional().isString(),
    validate,
  ],
  aiCtrl.askAssistant
);

// ── Stage 1: Intent Validation (validates prompt & plans multi-page flow) ──
router.post(
  "/validate-intent",
  [
    body("prompt").isString().trim().notEmpty(),
    body("currentUrl").optional().isString(),
    body("language").optional().isIn(["km", "en"]),
    validate,
  ],
  aiCtrl.validateIntent
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

// ── Stage 2: Step Generation from DOM Elements ──
router.post(
  "/generate-steps",
  [
    body("prompt").isString().trim().notEmpty(),
    body("elements").isArray({ min: 1 }),
    body("language").optional().isIn(["km", "en"]),
    body("currentUrl").optional().isString(),
    body("mode").optional().isIn(["initial", "next_action"]),
    body("completedActions").optional().isArray(),
    validate,
  ],
  aiCtrl.generateSteps
);

export default router;

