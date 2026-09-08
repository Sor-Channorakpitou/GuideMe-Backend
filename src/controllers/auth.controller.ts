import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import { env } from "../config/env.js";
import * as authService from "../services/auth.service.js";

const COOKIE_NAME = "token";

function setAuthCookie(res: Response, token: string, rememberMe: boolean): void {
  const isProduction = process.env.NODE_ENV === "production";

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    ...(rememberMe ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
  });
}

function clearAuthCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

function formatUserResponse(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    language: user.language,
    plan: user.plan,
    avatar: user.avatar,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  };
}

export async function register(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, name, rememberMe } = req.body;
    const user = await authService.registerUser({ name, email, password });
    const token = authService.signToken(user.id);
    setAuthCookie(res, token, !!rememberMe);
    res.status(201).json({ user: formatUserResponse(user), token });
  } catch (err) {
    next(err);
  }
}

export async function login(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password, rememberMe } = req.body;
    const user = await authService.loginUser(email, password);
    const token = authService.signToken(user.id);
    setAuthCookie(res, token, !!rememberMe);
    res.json({ user: formatUserResponse(user), token });
  } catch (err) {
    next(err);
  }
}

export async function googleAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { access_token, rememberMe } = req.body;
    const user = await authService.authenticateGoogleUser(access_token);
    const token = authService.signToken(user.id);
    setAuthCookie(res, token, !!rememberMe);
    res.json({ user: formatUserResponse(user), token });
  } catch (err) {
    next(err);
  }
}

export async function facebookAuth(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { accessToken, rememberMe } = req.body;
    const user = await authService.authenticateFacebookUser(accessToken);
    const token = authService.signToken(user.id);
    setAuthCookie(res, token, !!rememberMe);
    res.json({ user: formatUserResponse(user), token });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email } = req.body;
    const result = await authService.requestPasswordReset(email);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { token, password } = req.body;
    const result = await authService.resetUserPassword(token, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await authService.getUserById(req.userId!);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function logout(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    clearAuthCookie(res);
    res.json({ message: "Logged out successfully" });
  } catch (err) {
    next(err);
  }
}
