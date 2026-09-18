import prisma from "../config/db.js";

export interface GuideStep {
  stepNumber: number;
  title: string;
  instruction: string;
  hint?: string;
  targetElement?: string;
  screenshotUrl?: string;
  audioUrl?: string;
}

export async function getAllGuides(options: { category?: string; search?: string; page?: number; limit?: number }) {
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(50, Math.max(1, options.limit || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (options.category && options.category !== "all") {
    where.category = { equals: options.category, mode: "insensitive" };
  }
  if (options.search) {
    where.OR = [
      { title: { contains: options.search, mode: "insensitive" } },
      { description: { contains: options.search, mode: "insensitive" } },
    ];
  }

  const [guides, total] = await Promise.all([
    prisma.guide.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.guide.count({ where }),
  ]);

  return { guides, total, page, limit };
}

export async function getGuideById(guideId: string) {
  const guide = await prisma.guide.findUnique({
    where: { id: guideId },
  });

  if (!guide) {
    const error: any = new Error("Guide not found");
    error.statusCode = 404;
    error.code = "NOT_FOUND";
    throw error;
  }

  return guide;
}

export async function createGuide(data: {
  title: string;
  description: string;
  category: string;
  steps: GuideStep[];
  authorId: string;
}) {
  return prisma.guide.create({
    data: {
      title: data.title,
      description: data.description,
      category: data.category,
      steps: data.steps as any,
      authorId: data.authorId,
    },
  });
}

/**
 * Throws a 403 unless `requesterId` is the guide's author, or `isAdmin` is
 * true. A guide with no author (authorId === null — pre-existing/seeded
 * catalog entries) can only be modified by an admin. Previously any
 * authenticated user could update/delete any guide by id with no ownership
 * check at all.
 */
async function assertCanModifyGuide(guideId: string, requesterId: string, isAdmin: boolean) {
  if (isAdmin) return;
  const guide = await prisma.guide.findUnique({ where: { id: guideId }, select: { authorId: true } });
  if (!guide) {
    const error: any = new Error("Guide not found");
    error.statusCode = 404;
    error.code = "NOT_FOUND";
    throw error;
  }
  if (guide.authorId !== requesterId) {
    const error: any = new Error("You don't have permission to modify this guide");
    error.statusCode = 403;
    error.code = "FORBIDDEN";
    throw error;
  }
}

export async function updateGuide(
  guideId: string,
  data: {
    title?: string;
    description?: string;
    category?: string;
    steps?: GuideStep[];
  },
  requesterId: string,
  isAdmin: boolean
) {
  await assertCanModifyGuide(guideId, requesterId, isAdmin);
  return prisma.guide.update({
    where: { id: guideId },
    data: {
      ...(data.title && { title: data.title }),
      ...(data.description && { description: data.description }),
      ...(data.category && { category: data.category }),
      ...(data.steps && { steps: data.steps as any }),
    },
  });
}

export async function deleteGuide(guideId: string, requesterId: string, isAdmin: boolean) {
  await assertCanModifyGuide(guideId, requesterId, isAdmin);
  await prisma.guide.delete({
    where: { id: guideId },
  });
  return { message: "Guide deleted successfully" };
}

export async function getUserGuideProgress(userId: string, guideId: string) {
  const userGuide = await prisma.userGuide.findUnique({
    where: {
      userId_guideId: { userId, guideId },
    },
    include: { guide: true },
  });

  return userGuide;
}

export async function syncUserGuideProgress(
  userId: string,
  guideId: string,
  currentStep: number,
  totalSteps: number,
  completed?: boolean
) {
  const isCompleted = completed || currentStep >= totalSteps;

  const userGuide = await prisma.userGuide.upsert({
    where: {
      userId_guideId: { userId, guideId },
    },
    update: {
      currentStep,
      totalSteps,
      completed: isCompleted,
    },
    create: {
      userId,
      guideId,
      currentStep,
      totalSteps,
      completed: isCompleted,
    },
    include: { guide: true },
  });

  // Track activity log
  await prisma.activity.create({
    data: {
      userId,
      guideId,
      type: isCompleted ? "COMPLETED_GUIDE" : "UPDATED_STEP",
      description: isCompleted
        ? `Completed tutorial "${userGuide.guide.title}"`
        : `Progressed to step ${currentStep}/${totalSteps} in "${userGuide.guide.title}"`,
    },
  });

  return userGuide;
}
