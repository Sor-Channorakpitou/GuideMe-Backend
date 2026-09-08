import { Router } from "express";
import { body } from "express-validator";
import { validate } from "../middleware/validate.js";
import { auth } from "../middleware/auth.js";
import * as ctrl from "../controllers/user.controller.js";

const router = Router();
const avatarUpload = ctrl.upload.single("avatar");
router.use(auth);

/**
 * @openapi
 * /api/user/profile:
 *   get:
 *     tags: [User]
 *     summary: Get user profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/User"
 *   put:
 *     tags: [User]
 *     summary: Update user profile
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:     { type: string }
 *               email:    { type: string, format: email }
 *               phone:    { type: string }
 *               language: { type: string, enum: [km, en] }
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.get("/profile", ctrl.getProfile);
router.put("/profile", [
  body("name").optional().notEmpty(),
  body("email").optional().isEmail(),
  body("phone").optional(),
  body("language").optional().isIn(["km", "en"]),
  validate,
], ctrl.updateProfile);

/**
 * @openapi
 * /api/user/password:
 *   put:
 *     tags: [User]
 *     summary: Change password
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword:     { type: string, minLength: 6 }
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Current password incorrect
 */
router.put("/password", [
  body("currentPassword").notEmpty(),
  body("newPassword").isLength({ min: 6 }),
  validate,
], ctrl.changePassword);

router.put("/set-password", [
  body("newPassword").isLength({ min: 6 }),
  validate,
], ctrl.setPassword);

/**
 * @openapi
 * /api/user/avatar:
 *   post:
 *     tags: [User]
 *     summary: Upload avatar image
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               avatar:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Avatar uploaded
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url: { type: string }
 */
router.post("/avatar", avatarUpload, ctrl.uploadAvatar);

/**
 * @openapi
 * /api/user/account:
 *   delete:
 *     tags: [User]
 *     summary: Delete account (irreversible)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Account deleted
 */
router.delete("/account", ctrl.deleteAccount);

/**
 * @openapi
 * /api/user/notification-settings:
 *   get:
 *     tags: [User]
 *     summary: Get notification preferences
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notification settings
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/NotificationSettings"
 *   put:
 *     tags: [User]
 *     summary: Update notification preferences
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/NotificationSettings"
 *     responses:
 *       200:
 *         description: Notification settings updated
 */
router.get("/notification-settings", ctrl.getNotificationSettings);
router.put("/notification-settings", [
  body("email").optional().isBoolean(),
  body("push").optional().isBoolean(),
  body("newGuides").optional().isBoolean(),
  body("updates").optional().isBoolean(),
  body("tips").optional().isBoolean(),
  validate,
], ctrl.updateNotificationSettings);

/**
 * @openapi
 * /api/user/app-settings:
 *   get:
 *     tags: [User]
 *     summary: Get app settings
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: App settings
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/AppSettings"
 *   put:
 *     tags: [User]
 *     summary: Update app settings
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/AppSettings"
 *     responses:
 *       200:
 *         description: App settings updated
 */
router.get("/app-settings", ctrl.getAppSettings);
router.put("/app-settings", [
  body("overlayEnabled").optional().isBoolean(),
  body("voiceEnabled").optional().isBoolean(),
  body("readingSpeed").optional().isIn(["slow", "normal", "fast"]),
  validate,
], ctrl.updateAppSettings);

/**
 * @openapi
 * /api/user/stats:
 *   get:
 *     tags: [User]
 *     summary: Get user statistics
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User stats
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Stats"
 */
router.get("/stats", ctrl.getStats);

/**
 * @openapi
 * /api/user/activity:
 *   get:
 *     tags: [User]
 *     summary: Get recent activity feed
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Activity list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/Activity"
 */
router.get("/activity", ctrl.getActivity);

/**
 * @openapi
 * /api/user/progress:
 *   get:
 *     tags: [User]
 *     summary: Get current guide progress
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current progress
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Progress"
 */
router.get("/progress", ctrl.getProgress);

/**
 * @openapi
 * /api/user/progress:
 *   post:
 *     tags: [User]
 *     summary: Batch sync guide progress from extension
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: "#/components/schemas/UpdateProgressPayload"
 *     responses:
 *       200:
 *         description: Progress successfully synchronized
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 syncedCount:
 *                   type: integer
 */
router.post(
  "/progress",
  [
    body("batch").isArray({ min: 1 }).withMessage("batch must be a non-empty array"),
    body("batch.*.guideId").isString().notEmpty().withMessage("guideId is required"),
    body("batch.*.stepIndex").isInt({ min: 0 }).withMessage("stepIndex must be a non-negative integer"),
    body("batch.*.completedAt").optional().isString().withMessage("completedAt must be a valid date string"),
    validate,
  ],
  ctrl.syncProgressBatch
);

export default router;