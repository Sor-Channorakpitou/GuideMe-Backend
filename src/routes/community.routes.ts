import { Router } from "express";
import { body, query } from "express-validator";
import { validate } from "../middleware/validate.js";
import { auth } from "../middleware/auth.js";
import * as ctrl from "../controllers/community.controller.js";

const router = Router();

/**
 * @openapi
 * /api/community/posts:
 *   get:
 *     tags: [Community]
 *     summary: List community posts (paginated)
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10 }
 *     responses:
 *       200:
 *         description: List of posts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 posts:
 *                   type: array
 *                   items:
 *                     $ref: "#/components/schemas/CommunityPost"
 *                 total: { type: integer }
 *                 page:  { type: integer }
 *   post:
 *     tags: [Community]
 *     summary: Create a community post
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [category, title, description]
 *             properties:
 *               category:    { type: string, example: "គន្លឹះ" }
 *               title:       { type: string, example: "របៀបប្រើ Google Drive" }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Post created
 */
router.get("/posts", ctrl.getPosts);
router.post("/posts", auth, [
  body("category").notEmpty(),
  body("title").notEmpty(),
  body("description").notEmpty(),
  validate,
], ctrl.createPost);

/**
 * @openapi
 * /api/community/posts/{id}/like:
 *   post:
 *     tags: [Community]
 *     summary: Toggle like on a post
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Like toggled
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 liked: { type: boolean }
 *                 likes: { type: integer }
 */
router.post("/posts/:id/like", auth, ctrl.toggleLike);

/**
 * @openapi
 * /api/community/posts/{id}/comment:
 *   post:
 *     tags: [Community]
 *     summary: Add a comment to a post
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [content]
 *             properties:
 *               content: { type: string }
 *     responses:
 *       201:
 *         description: Comment added
 */
router.post("/posts/:id/comment", auth, [
  body("content").notEmpty(),
  validate,
], ctrl.addComment);

/**
 * @openapi
 * /api/community/contributors:
 *   get:
 *     tags: [Community]
 *     summary: Get top contributors
 *     responses:
 *       200:
 *         description: Top contributors list
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/Contributor"
 */
router.get("/contributors", ctrl.getContributors);

/**
 * @openapi
 * /api/community/search:
 *   get:
 *     tags: [Community]
 *     summary: Search community posts
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Search results
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: "#/components/schemas/CommunityPost"
 */
router.get("/search", [
  query("q").notEmpty(),
  validate,
], ctrl.searchPosts);

export default router;