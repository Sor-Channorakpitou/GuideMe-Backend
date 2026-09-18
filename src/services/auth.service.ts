import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../config/db.js";
import { env } from "../config/env.js";
import { sendPasswordResetEmail } from "./email.js";

export function signToken(userId: string): string {
  return jwt.sign({ userId, type: "access" }, env.JWT_SECRET, { expiresIn: "7d" });
}

export async function registerUser(data: { name: string; email: string; password?: string }) {
  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) {
    const error: any = new Error("Email already registered");
    error.statusCode = 400;
    error.code = "EMAIL_EXISTS";
    throw error;
  }

  const hashedPassword = data.password ? await bcrypt.hash(data.password, 10) : null;

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email,
      password: hashedPassword,
    },
  });

  await prisma.notificationSetting.create({ data: { userId: user.id } });
  await prisma.appSetting.create({ data: { userId: user.id } });
  await prisma.billing.create({ data: { userId: user.id, plan: "FREE", status: "ACTIVE" } });

  return user;
}

export async function loginUser(email: string, password?: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password || !password) {
    const error: any = new Error("Invalid email or password");
    error.statusCode = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    const error: any = new Error("Invalid email or password");
    error.statusCode = 401;
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }

  return user;
}

export async function authenticateGoogleUser(accessToken: string) {
  if (!env.GOOGLE_CLIENT_ID) {
    const error: any = new Error("Google OAuth not configured");
    error.statusCode = 500;
    error.code = "CONFIG_ERROR";
    throw error;
  }

  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userRes.ok) {
    const error: any = new Error("Invalid Google token");
    error.statusCode = 400;
    error.code = "INVALID_TOKEN";
    throw error;
  }

  const payload: any = await userRes.json();
  if (!payload || !payload.email) {
    const error: any = new Error("Invalid Google token");
    error.statusCode = 400;
    error.code = "INVALID_TOKEN";
    throw error;
  }

  let user = await prisma.user.findFirst({
    where: { OR: [{ googleId: payload.sub }, { email: payload.email }] },
  });

  if (user) {
    if (!user.googleId) {
      await prisma.user.update({ where: { id: user.id }, data: { googleId: payload.sub } });
    }
  } else {
    user = await prisma.user.create({
      data: {
        name: payload.name || "User",
        email: payload.email,
        googleId: payload.sub,
        avatar: payload.picture,
        emailVerified: true,
      },
    });
    await prisma.notificationSetting.create({ data: { userId: user.id } });
    await prisma.appSetting.create({ data: { userId: user.id } });
    await prisma.billing.create({ data: { userId: user.id, plan: "FREE", status: "ACTIVE" } });
  }

  return user;
}

export async function authenticateFacebookUser(accessToken: string) {
  const fbRes = await fetch(
    `https://graph.facebook.com/me?fields=id,name,email,picture&access_token=${accessToken}`
  );
  const data: any = await fbRes.json();
  if (!data.id) {
    const error: any = new Error("Invalid Facebook token");
    error.statusCode = 400;
    error.code = "INVALID_TOKEN";
    throw error;
  }

  const fbEmail = data.email || `fb_${data.id}@facebook.guideme.app`;
  let user = await prisma.user.findFirst({
    where: { OR: [{ facebookId: data.id }, { email: fbEmail }] },
  });

  if (user) {
    if (!user.facebookId) {
      await prisma.user.update({ where: { id: user.id }, data: { facebookId: data.id } });
    }
  } else {
    user = await prisma.user.create({
      data: {
        name: data.name || "User",
        email: fbEmail,
        facebookId: data.id,
        avatar: data.picture?.data?.url,
        emailVerified: true,
      },
    });
    await prisma.notificationSetting.create({ data: { userId: user.id } });
    await prisma.appSetting.create({ data: { userId: user.id } });
    await prisma.billing.create({ data: { userId: user.id, plan: "FREE", status: "ACTIVE" } });
  }

  return user;
}

export async function requestPasswordReset(email: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const token = jwt.sign({ userId: user.id, type: "reset" }, env.JWT_SECRET, { expiresIn: "15m" });
    await sendPasswordResetEmail(email, token);
  }
  return { message: "If the email exists, a reset link has been sent" };
}

export async function resetUserPassword(token: string, newPassword: string) {
  let decoded: { userId: string; type?: string };
  try {
    decoded = jwt.verify(token, env.JWT_SECRET) as { userId: string; type?: string };
  } catch {
    const error: any = new Error("Invalid or expired reset token");
    error.statusCode = 400;
    error.code = "INVALID_TOKEN";
    throw error;
  }

  if (decoded.type !== "reset") {
    const error: any = new Error("Invalid or expired reset token");
    error.statusCode = 400;
    error.code = "INVALID_TOKEN";
    throw error;
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: decoded.userId },
    data: { password: hashedPassword },
  });

  return { message: "Password updated successfully" };
}

export async function getUserById(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      avatar: true,
      language: true,
      plan: true,
      emailVerified: true,
      createdAt: true,
    },
  });

  if (!user) {
    const error: any = new Error("User not found");
    error.statusCode = 404;
    error.code = "NOT_FOUND";
    throw error;
  }

  return user;
}
