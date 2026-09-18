import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AuthRequest extends Request {
  userId?: string;
  body: any;
  query: any;
  params: any;
  headers: any;
  file?: any;
}

export function auth(req: AuthRequest, res: Response, next: NextFunction): void {
  let token: string | undefined;

  // 1. Try httpOnly cookie first
  if (req.cookies?.token) {
    token = req.cookies.token;
  }

  // 2. Fall back to Authorization header (for backwards compat / API clients)
  if (!token) {
    const header = req.headers.authorization;
    if (header && header.startsWith("Bearer ")) {
      token = header.split(" ")[1];
    }
  }

  if (!token) {
    res.status(401).json({ error: { message: "No token provided", code: "UNAUTHORIZED" } });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string; type?: string };
    // Reject password-reset tokens (and any other non-session token type) from
    // being used as a general session credential — see GM-003.
    if (decoded.type && decoded.type !== "access") {
      res.status(401).json({ error: { message: "Invalid token", code: "UNAUTHORIZED" } });
      return;
    }
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: { message: "Invalid token", code: "UNAUTHORIZED" } });
    return;
  }
}
