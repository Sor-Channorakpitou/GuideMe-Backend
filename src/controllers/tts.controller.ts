import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import * as ttsService from "../services/tts.service.js";

export async function synthesize(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { text, language, speed, voiceGender } = req.body;
    const result = await ttsService.synthesizeSpeech({
      text,
      language,
      speed,
      voiceGender,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
