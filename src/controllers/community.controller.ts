import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import * as communityService from "../services/community.service.js";

export async function getPosts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 10;
    const result = await communityService.getCommunityPosts(page, limit);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function createPost(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { category, title, description } = req.body;
    const post = await communityService.createCommunityPost(req.userId!, { category, title, description });
    res.status(201).json(post);
  } catch (err) {
    next(err);
  }
}

export async function toggleLike(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const postId = req.params.id as string;
    const result = await communityService.togglePostLike(postId, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function addComment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const postId = req.params.id as string;
    const { content } = req.body;
    const comment = await communityService.addPostComment(postId, req.userId!, content);
    res.status(201).json(comment);
  } catch (err) {
    next(err);
  }
}

export async function getContributors(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const contributors = await communityService.getTopContributors();
    res.json(contributors);
  } catch (err) {
    next(err);
  }
}

export async function searchPosts(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = (req.query.q as string) || "";
    const posts = await communityService.searchCommunityPosts(q);
    res.json(posts);
  } catch (err) {
    next(err);
  }
}
