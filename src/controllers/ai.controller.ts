import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import * as aiService from "../services/ai.service.js";

/** Pull aiUser attached by aiRateLimit middleware (undefined on unprotected routes). */
function getAiUser(req: AuthRequest) {
  return (req as any).aiUser as
    | { id: string; plan: string; used: number; limit: number }
    | undefined;
}

export async function generateGuide(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, category, language } = req.body;
    const result = await aiService.generateGuideSteps(prompt, category, language);
    const aiUser = getAiUser(req);
    res.json({
      ...result,
      ...(aiUser && { _usage: { used: aiUser.used, limit: aiUser.limit, plan: aiUser.plan } }),
    });
  } catch (err) {
    next(err);
  }
}

export async function askAssistant(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { question, context, language, image } = req.body;
    const result = await aiService.askContextualAssistant(question, context, language, image);
    const aiUser = getAiUser(req);
    res.json({
      ...result,
      ...(aiUser && { _usage: { used: aiUser.used, limit: aiUser.limit, plan: aiUser.plan } }),
    });
  } catch (err) {
    next(err);
  }
}

export async function rerankIntentCandidates(req: any, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, candidates } = req.body;
    const result = await aiService.rerankIntentCandidates(prompt, candidates);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function generateDomGuide(req: any, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, elements, url, language } = req.body;
    const result = await aiService.generateDomGuideSteps({ prompt, elements, url, language });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function validateIntent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, currentUrl, language } = req.body;
    const result = await aiService.validateIntent(prompt, currentUrl, language);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function generateSteps(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, elements, language, currentUrl, mode, completedActions } = req.body;
    const result = await aiService.generateSteps(prompt, elements, language, currentUrl, {
      mode,
      completedActions,
    });
    if (result) {
      res.json(result);
    } else {
      res.status(503).json({ error: { message: "Step generation unavailable", code: "SERVICE_UNAVAILABLE" } });
    }
  } catch (err) {
    next(err);
  }
}
