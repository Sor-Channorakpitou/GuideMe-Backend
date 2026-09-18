import { Router } from "express";
import { body } from "express-validator";
import { validate } from "../middleware/validate.js";
import { auth } from "../middleware/auth.js";
import { authRateLimit } from "../middleware/authRateLimit.js";
import * as ctrl from "../controllers/auth.controller.js";

const router = Router();

/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Create a new account
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password, name]
 *             properties:
 *               email:       { type: string, format: email, example: user@example.com }
 *               password:    { type: string, minLength: 6, example: "password123" }
 *               name:        { type: string, example: "Sopheak Chan" }
 *               rememberMe:  { type: boolean }
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/LoginResponse"
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/Error"
 */
router.post("/register", authRateLimit, [
  body("email").isEmail(),
  body("password").isLength({ min: 6 }),
  body("name").notEmpty(),
  body("rememberMe").optional().isBoolean(),
  validate,
], ctrl.register);

/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login with email and password
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:       { type: string, format: email }
 *               password:    { type: string }
 *               rememberMe:  { type: boolean }
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/LoginResponse"
 *       401:
 *         description: Invalid credentials
 */
router.post("/login", authRateLimit, [
  body("email").isEmail(),
  body("password").notEmpty(),
  body("rememberMe").optional().isBoolean(),
  validate,
], ctrl.login);

/**
 * @openapi
 * /api/auth/google:
 *   post:
 *     tags: [Auth]
 *     summary: Login or register with Google
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [access_token]
 *             properties:
 *               access_token:  { type: string, description: Google access token }
 *               rememberMe:    { type: boolean }
 *     responses:
 *       200:
 *         description: Google auth successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/LoginResponse"
 */
router.post("/google", [
  body("access_token").notEmpty(),
  body("rememberMe").optional().isBoolean(),
  validate,
], ctrl.googleAuth);

// /**
//  * @openapi
//  * /api/auth/facebook:
//  *   post:
//  *     tags: [Auth]
//  *     summary: Login or register with Facebook
//  *     requestBody:
//  *       required: true
//  *       content:
//  *         application/json:
//  *           schema:
//  *             type: object
//  *             required: [accessToken]
//  *             properties:
//  *               accessToken: { type: string, description: Facebook access token }
//  *     responses:
//  *       200:
//  *         description: Facebook auth successful
//  *         content:
//  *           application/json:
//  *             schema:
//  *               $ref: "#/components/schemas/LoginResponse"
//  */
// router.post("/facebook", [
//   body("accessToken").notEmpty(),
//   validate,
// ], ctrl.facebookAuth);

/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request password reset email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email: { type: string, format: email }
 *     responses:
 *       200:
 *         description: Reset email sent (if account exists)
 */
router.post("/forgot-password", authRateLimit, [
  body("email").isEmail(),
  validate,
], ctrl.forgotPassword);

/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using a reset token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, password]
 *             properties:
 *               token:    { type: string, description: Reset token from email }
 *               password: { type: string, minLength: 6 }
 *     responses:
 *       200:
 *         description: Password updated successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post("/reset-password", authRateLimit, [
  body("token").notEmpty(),
  body("password").isLength({ min: 6 }),
  validate,
], ctrl.resetPassword);

/**
 * @openapi
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: "#/components/schemas/User"
 *       401:
 *         description: Unauthorized
 */
router.get("/me", auth, ctrl.getMe);

/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout and clear auth cookie
 *     responses:
 *       200:
 *         description: Logged out successfully
 */
router.post("/logout", ctrl.logout);

export default router;