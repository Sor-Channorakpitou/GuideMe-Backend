import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import * as guideService from "../services/guide.service.js";
import prisma from "../config/db.js";

async function isAdminUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return user?.role === "ADMIN";
}

export async function getGuides(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = req.query.category as string | undefined;
    const search = req.query.search as string | undefined;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const result = await guideService.getAllGuides({ category, search, page, limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getGuide(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const guideId = req.params.id as string;
    const guide = await guideService.getGuideById(guideId);
    res.json(guide);
  } catch (err) {
    next(err);
  }
}

export async function createGuide(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { title, description, category, steps } = req.body;
    const guide = await guideService.createGuide({ title, description, category, steps, authorId: req.userId! });
    res.status(201).json(guide);
  } catch (err) {
    next(err);
  }
}

export async function updateGuide(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const guideId = req.params.id as string;
    const { title, description, category, steps } = req.body;
    const isAdmin = await isAdminUser(req.userId!);
    const guide = await guideService.updateGuide(guideId, { title, description, category, steps }, req.userId!, isAdmin);
    res.json(guide);
  } catch (err) {
    next(err);
  }
}

export async function deleteGuide(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const guideId = req.params.id as string;
    const isAdmin = await isAdminUser(req.userId!);
    const result = await guideService.deleteGuide(guideId, req.userId!, isAdmin);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getProgress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const guideId = req.params.id as string;
    const progress = await guideService.getUserGuideProgress(req.userId!, guideId);
    if (progress) {
      res.json({
        ...progress,
        totalSteps: Math.max(1, progress.totalSteps || 1),
      });
      return;
    }

    const guide = await guideService.getGuideById(guideId);
    const totalSteps = Array.isArray(guide.steps) && guide.steps.length > 0 ? guide.steps.length : 1;

    res.json({
      currentStep: 1,
      totalSteps,
      completed: false,
    });
  } catch (err) {
    next(err);
  }
}

export async function syncProgress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const guideId = req.params.id as string;
    const { currentStep, totalSteps, completed } = req.body;
    const progress = await guideService.syncUserGuideProgress(
      req.userId!,
      guideId,
      Number(currentStep),
      Number(totalSteps),
      completed
    );
    res.json(progress);
  } catch (err) {
    next(err);
  }
}
