import { Router } from "express";
import { body, query, param } from "express-validator";
import { auth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import * as guideCtrl from "../controllers/guide.controller.js";

const router = Router();

// ── Guide Catalog (Public / Authenticated) ──
router.get(
  "/",
  [
    query("category").optional().isString(),
    query("search").optional().isString(),
    query("page").optional().isInt({ min: 1 }),
    query("limit").optional().isInt({ min: 1, max: 50 }),
    validate,
  ],
  guideCtrl.getGuides
);

router.get(
  "/:id",
  [param("id").isString().notEmpty(), validate],
  guideCtrl.getGuide
);

// ── Authoring APIs (Requires Auth) ──
router.post(
  "/",
  auth,
  [
    body("title").isString().trim().notEmpty(),
    body("description").isString().trim().notEmpty(),
    body("category").isString().trim().notEmpty(),
    body("steps").isArray({ min: 1 }),
    body("steps.*.stepNumber").isInt({ min: 1 }),
    body("steps.*.title").isString().notEmpty(),
    body("steps.*.instruction").isString().notEmpty(),
    validate,
  ],
  guideCtrl.createGuide
);

router.put(
  "/:id",
  auth,
  [
    param("id").isString().notEmpty(),
    body("title").optional().isString().trim(),
    body("description").optional().isString().trim(),
    body("category").optional().isString().trim(),
    body("steps").optional().isArray(),
    validate,
  ],
  guideCtrl.updateGuide
);

router.delete(
  "/:id",
  auth,
  [param("id").isString().notEmpty(), validate],
  guideCtrl.deleteGuide
);

// ── Progress Sync ──
router.get(
  "/:id/progress",
  auth,
  [param("id").isString().notEmpty(), validate],
  guideCtrl.getProgress
);

router.post(
  "/:id/progress",
  auth,
  [
    param("id").isString().notEmpty(),
    body("currentStep").isInt({ min: 1 }),
    body("totalSteps").isInt({ min: 1 }),
    body("completed").optional().isBoolean(),
    validate,
  ],
  guideCtrl.syncProgress
);

export default router;
