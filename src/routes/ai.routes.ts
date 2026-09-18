import { Router } from "express";
import { body } from "express-validator";
import { auth } from "../middleware/auth.js";
import { aiRateLimit } from "../middleware/aiRateLimit.js";
import { requireProOrTrial } from "../middleware/requireProOrTrial.js";
import { validate } from "../middleware/validate.js";
import * as aiCtrl from "../controllers/ai.controller.js";

const router = Router();

// ── Auto-Step Generation Pipeline ──
router.post(
  "/generate-guide",
  auth,
  requireProOrTrial,
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
  requireProOrTrial,
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
  auth,
  requireProOrTrial,
  aiRateLimit,
  [
    body("prompt").isString().trim().notEmpty().isLength({ max: 4000 }),
    body("currentUrl").optional().isString().isLength({ max: 2000 }),
    body("language").optional().isIn(["km", "en"]),
    validate,
  ],
  aiCtrl.validateIntent
);

// ── Two-Stage Intent Candidate Re-Ranking (Extension API Client Endpoint) ──
router.post(
  "/intent-rerank",
  auth,
  requireProOrTrial,
  aiRateLimit,
  [
    body("prompt").isString().trim().notEmpty().isLength({ max: 4000 }),
    body("candidates").isArray({ min: 1, max: 50 }),
    validate,
  ],
  aiCtrl.rerankIntentCandidates
);

// ── Live DOM Candidate Walkthrough Synthesizer (Extension AI Agent Endpoint) ──
router.post(
  "/dom-guide",
  auth,
  requireProOrTrial,
  aiRateLimit,
  [
    body("prompt").isString().trim().notEmpty().isLength({ max: 4000 }),
    body("elements").isArray({ min: 1, max: 400 }),
    body("url").optional().isString().isLength({ max: 2000 }),
    body("language").optional().isIn(["km", "en"]),
    validate,
  ],
  aiCtrl.generateDomGuide
);

// ── Stage 2: Step Generation from DOM Elements ──
router.post(
  "/generate-steps",
  auth,
  requireProOrTrial,
  aiRateLimit,
  [
    body("prompt").isString().trim().notEmpty().isLength({ max: 4000 }),
    body("elements").isArray({ min: 1, max: 400 }),
    body("language").optional().isIn(["km", "en"]),
    body("currentUrl").optional().isString().isLength({ max: 2000 }),
    body("mode").optional().isIn(["initial", "next_action"]),
    body("completedActions").optional().isArray({ max: 100 }),
    body("intent").optional({ nullable: true }).isObject(),
    validate,
  ],
  aiCtrl.generateSteps
);

export default router;

