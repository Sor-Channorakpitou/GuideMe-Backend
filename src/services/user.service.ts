import bcrypt from "bcryptjs";
import prisma from "../config/db.js";

export async function getUserProfile(userId: string) {
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
      password: true,
    },
  });

  if (!user) {
    const error: any = new Error("User not found");
    error.statusCode = 404;
    error.code = "NOT_FOUND";
    throw error;
  }

  const { password, ...rest } = user;
  return { ...rest, hasPassword: !!password };
}

export async function updateUserProfile(
  userId: string,
  data: { name?: string; email?: string; phone?: string; language?: string }
) {
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.language !== undefined) updateData.language = data.language;

  return prisma.user.update({
    where: { id: userId },
    data: updateData,
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
}

export async function setUserPassword(userId: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { password: true } });
  if (user?.password) {
    const error: any = new Error("Password already set");
    error.statusCode = 400;
    error.code = "PASSWORD_EXISTS";
    throw error;
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
  return { message: "Password set successfully" };
}

export async function changeUserPassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.password) {
    const error: any = new Error("No password set");
    error.statusCode = 400;
    error.code = "NO_PASSWORD";
    throw error;
  }

  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) {
    const error: any = new Error("Current password is incorrect");
    error.statusCode = 400;
    error.code = "WRONG_PASSWORD";
    throw error;
  }

  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
  return { message: "Password changed" };
}

export async function updateUserAvatar(userId: string, avatarUrl: string) {
  return prisma.user.update({
    where: { id: userId },
    data: { avatar: avatarUrl },
    select: { id: true, avatar: true },
  });
}

export async function deleteUserAccount(userId: string) {
  await prisma.user.delete({ where: { id: userId } });
  return { message: "Account deleted" };
}

export async function getNotificationSettings(userId: string) {
  let settings = await prisma.notificationSetting.findUnique({ where: { userId } });
  if (!settings) {
    settings = await prisma.notificationSetting.create({ data: { userId } });
  }
  return settings;
}

export async function updateNotificationSettings(userId: string, data: Record<string, unknown>) {
  return prisma.notificationSetting.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

export async function getAppSettings(userId: string) {
  let settings = await prisma.appSetting.findUnique({ where: { userId } });
  if (!settings) {
    settings = await prisma.appSetting.create({ data: { userId } });
  }
  return settings;
}

export async function updateAppSettings(userId: string, data: Record<string, unknown>) {
  return prisma.appSetting.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data },
  });
}

export async function getUserStats(userId: string) {
  const totalGuides = await prisma.userGuide.count({ where: { userId } });
  const completed = await prisma.userGuide.count({ where: { userId, completed: true } });
  return { totalGuides, completedGuides: completed, rating: 4.9 };
}

export async function getUserActivity(userId: string) {
  return prisma.activity.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { guide: { select: { title: true } } },
  });
}

export async function getUserCurrentProgress(userId: string) {
  const ug = await prisma.userGuide.findFirst({
    where: { userId, completed: false },
    orderBy: { updatedAt: "desc" },
    include: { guide: { select: { title: true } } },
  });

  if (!ug) {
    return { guideName: null, currentStep: 0, totalSteps: 0, percentage: 0 };
  }

  return {
    guideName: ug.guide.title,
    currentStep: ug.currentStep,
    totalSteps: ug.totalSteps,
    percentage: Math.round((ug.currentStep / ug.totalSteps) * 100),
  };
}

export interface StepCompletionItem {
  guideId: string;
  stepIndex: number;
  completedAt?: string;
}

export async function batchSyncUserProgress(userId: string, batch: StepCompletionItem[]) {
  if (!batch || !Array.isArray(batch) || batch.length === 0) {
    return { success: true, syncedCount: 0 };
  }

  let syncedCount = 0;

  for (const item of batch) {
    if (!item.guideId) continue;

    // Check if the guide exists in the database
    const guide = await prisma.guide.findUnique({
      where: { id: item.guideId },
    });

    if (guide) {
      const stepNumber = Math.max(1, (item.stepIndex ?? 0) + 1);
      const totalSteps = Array.isArray(guide.steps) ? guide.steps.length : Math.max(1, stepNumber);
      const completed = stepNumber >= totalSteps;

      await prisma.userGuide.upsert({
        where: { userId_guideId: { userId, guideId: item.guideId } },
        update: {
          currentStep: stepNumber,
          totalSteps,
          completed,
        },
        create: {
          userId,
          guideId: item.guideId,
          currentStep: stepNumber,
          totalSteps,
          completed,
        },
      });

      await prisma.activity.create({
        data: {
          userId,
          guideId: item.guideId,
          type: completed ? "COMPLETED_GUIDE" : "UPDATED_STEP",
          description: completed
            ? `Completed tutorial "${guide.title}"`
            : `Progressed to step ${stepNumber}/${totalSteps} in "${guide.title}"`,
        },
      });
      syncedCount++;
    } else {
      // For custom/client-generated guides without a backend database record, record user activity
      await prisma.activity.create({
        data: {
          userId,
          type: "UPDATED_STEP",
          description: `Progressed in guide "${item.guideId}" (step ${(item.stepIndex ?? 0) + 1})`,
        },
      });
      syncedCount++;
    }
  }

  return { success: true, syncedCount };
}
