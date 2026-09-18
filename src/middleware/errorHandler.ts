import { Request, Response, NextFunction } from "express";

interface AppError extends Error {
  statusCode?: number;
  code?: string;
}

export function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void {
  console.error("[ERROR]", err.message, err.stack?.split("\n")[1] || "");

  const statusCode = err.statusCode || 500;
  const code = err.code || (statusCode === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");

  // GM-013: only forward `err.message` verbatim when it came from an
  // intentional AppError (an explicit statusCode was set somewhere in the
  // app, meaning the message was authored to be user-facing/safe). An
  // unhandled exception with no statusCode is, by definition, something the
  // app didn't anticipate — its raw message could be a Prisma/DB error, a
  // stack-trace fragment, or any other internal detail, so it's replaced
  // with a generic message. The full error is still logged server-side above.
  const isIntentionalAppError = typeof err.statusCode === "number";
  const clientMessage = isIntentionalAppError
    ? err.message || "Internal server error"
    : "Something went wrong. Please try again.";

  res.status(statusCode).json({
    error: {
      message: clientMessage,
      code,
    },
  });
}
