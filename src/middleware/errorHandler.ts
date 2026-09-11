import { Request, Response, NextFunction } from "express";

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[ERROR]", err.message, err.stack?.split("\n")[1] || "");

  const statusCode = err.statusCode || 500;
  const code = err.code || (statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");

  res.status(statusCode).json({
    error: {
      message: err.message || "Internal server error",
      code,
    },
  });
}
