import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import * as aiService from "../services/ai.service.js";

export async function generateGuide(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, category, language } = req.body;
    const result = await aiService.generateGuideSteps(prompt, category, language);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function askAssistant(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { question, context, language } = req.body;
    const result = await aiService.askContextualAssistant(question, context, language);
    res.json(result);
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
