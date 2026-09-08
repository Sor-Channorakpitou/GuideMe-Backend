import { Request, Response, NextFunction } from "express";
import { validationResult } from "express-validator";

export function validate(req: Request, res: Response, next: NextFunction): void {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      error: {
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        details: errors.array(),
      },
    });
    return;
  }
  next();
}
