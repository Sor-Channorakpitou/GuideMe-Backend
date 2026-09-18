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
    const aiUser = getAiUser(req);
    const result = await aiService.generateGuideSteps(prompt, category, language, aiUser?.plan);
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
    const aiUser = getAiUser(req);
    const result = await aiService.askContextualAssistant(question, context, language, image, aiUser?.plan);
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
    const aiUser = getAiUser(req);
    const result = await aiService.rerankIntentCandidates(prompt, candidates, aiUser?.plan);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function generateDomGuide(req: any, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, elements, url, language } = req.body;
    const aiUser = getAiUser(req);
    const result = await aiService.generateDomGuideSteps({ prompt, elements, url, language, planTier: aiUser?.plan });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function validateIntent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, currentUrl, language } = req.body;
    const aiUser = getAiUser(req);
    const result = await aiService.validateIntent(prompt, currentUrl, language, aiUser?.plan);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function generateSteps(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prompt, elements, language, currentUrl, mode, completedActions, intent } = req.body;
    const aiUser = getAiUser(req);

    // Stream the result via Server-Sent Events so the client gets the tutorial
    // the moment the LLM finishes, without waiting for Express to buffer it.
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    let yielded = false;
    let streamError: string | null = null;
    try {
      const result = await aiService.generateSteps(prompt, elements, language, currentUrl, {
        mode,
        completedActions,
        intent,
        planTier: aiUser?.plan,
      });
      if (result) {
        yielded = true;
        // The client may have navigated away / closed the tab while the LLM
        // call was in flight — the socket is already gone by the time we
        // get here, so guard every write instead of throwing into the outer
        // catch (which would try to send a second, now-invalid response).
        if (!res.writableEnded && res.writable) {
          res.write(`data: ${JSON.stringify(result)}\n\n`);
        }
      }
    } catch (genErr: any) {
      // Headers are already flushed for SSE, so this can't go through next(err)
      // — but the client still needs the real reason, not a generic code, per
      // "if it fails, tell the user, don't hide it behind SERVICE_UNAVAILABLE".
      streamError = genErr?.message || "Guide generation failed for an unknown reason.";
      console.error("[AI Controller] generateSteps stream error:", streamError);
    }

    if (!res.writableEnded && res.writable) {
      if (!yielded) {
        res.write(`data: ${JSON.stringify({ error: streamError || "No AI provider returned a usable result." })}\n\n`);
      }
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (err) {
    if (res.headersSent) {
      // Streaming had already started — nothing more we can send; just log.
      console.error("[AI Controller] generateSteps error after headers sent:", (err as any)?.message);
      return;
    }
    next(err);
  }
}
