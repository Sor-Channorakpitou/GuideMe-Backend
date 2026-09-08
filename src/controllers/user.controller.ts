import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import * as userService from "../services/user.service.js";
import { uploadFile, uploadMiddleware } from "../services/storage.service.js";

export const upload = uploadMiddleware;

export async function getProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await userService.getUserProfile(req.userId!);
    res.json(profile);
  } catch (err) {
    next(err);
  }
}

export async function updateProfile(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, phone, language } = req.body;
    const updated = await userService.updateUserProfile(req.userId!, { name, email, phone, language });
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

export async function setPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { newPassword } = req.body;
    const result = await userService.setUserPassword(req.userId!, newPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await userService.changeUserPassword(req.userId!, currentPassword, newPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function uploadAvatar(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.file) {
      res.status(400).json({ error: { message: "No file uploaded", code: "NO_FILE" } });
      return;
    }
    const avatarUrl = await uploadFile(req.file, "guideme/avatars");
    await userService.updateUserAvatar(req.userId!, avatarUrl);
    res.json({ url: avatarUrl });
  } catch (err) {
    next(err);
  }
}

export async function deleteAccount(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await userService.deleteUserAccount(req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getNotificationSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await userService.getNotificationSettings(req.userId!);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateNotificationSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, push, newGuides, updates, tips } = req.body;
    const data: Record<string, unknown> = {};
    if (email !== undefined) data.email = email;
    if (push !== undefined) data.push = push;
    if (newGuides !== undefined) data.newGuides = newGuides;
    if (updates !== undefined) data.updates = updates;
    if (tips !== undefined) data.tips = tips;

    const settings = await userService.updateNotificationSettings(req.userId!, data);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function getAppSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const settings = await userService.getAppSettings(req.userId!);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function updateAppSettings(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { overlayEnabled, voiceEnabled, readingSpeed } = req.body;
    const data: Record<string, unknown> = {};
    if (overlayEnabled !== undefined) data.overlayEnabled = overlayEnabled;
    if (voiceEnabled !== undefined) data.voiceEnabled = voiceEnabled;
    if (readingSpeed !== undefined) data.readingSpeed = readingSpeed;

    const settings = await userService.updateAppSettings(req.userId!, data);
    res.json(settings);
  } catch (err) {
    next(err);
  }
}

export async function getStats(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await userService.getUserStats(req.userId!);
    res.json(stats);
  } catch (err) {
    next(err);
  }
}

export async function getActivity(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const activities = await userService.getUserActivity(req.userId!);
    res.json(activities);
  } catch (err) {
    next(err);
  }
}

export async function getProgress(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const progress = await userService.getUserCurrentProgress(req.userId!);
    res.json(progress);
  } catch (err) {
    next(err);
  }
}

export async function syncProgressBatch(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { batch } = req.body;
    const result = await userService.batchSyncUserProgress(req.userId!, batch);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
