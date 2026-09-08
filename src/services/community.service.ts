import prisma from "../config/db.js";

export async function getCommunityPosts(page = 1, limit = 10) {
  const safePage = Math.max(1, page);
  const safeLimit = Math.min(50, Math.max(1, limit));
  const skip = (safePage - 1) * safeLimit;

  const [posts, total] = await Promise.all([
    prisma.communityPost.findMany({
      skip,
      take: safeLimit,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, name: true, avatar: true } } },
    }),
    prisma.communityPost.count(),
  ]);

  return { posts, total, page: safePage, limit: safeLimit };
}

export async function createCommunityPost(
  userId: string,
  data: { category: string; title: string; description: string }
) {
  const post = await prisma.communityPost.create({
    data: { userId, category: data.category, title: data.title, description: data.description },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });

  await prisma.contributor.upsert({
    where: { userId },
    update: { postCount: { increment: 1 } },
    create: { userId, postCount: 1 },
  });

  return post;
}

export async function togglePostLike(postId: string, userId: string) {
  const post = await prisma.communityPost.findUnique({ where: { id: postId } });
  if (!post) {
    const error: any = new Error("Post not found");
    error.statusCode = 404;
    error.code = "NOT_FOUND";
    throw error;
  }

  const alreadyLiked = post.likedBy.includes(userId);
  const newLikes = alreadyLiked ? post.likes - 1 : post.likes + 1;

  await prisma.communityPost.update({
    where: { id: postId },
    data: {
      likes: newLikes,
      likedBy: alreadyLiked
        ? { set: post.likedBy.filter((id) => id !== userId) }
        : { push: userId },
    },
  });

  return { liked: !alreadyLiked, likes: newLikes };
}

export async function addPostComment(postId: string, userId: string, content: string) {
  const post = await prisma.communityPost.findUnique({ where: { id: postId } });
  if (!post) {
    const error: any = new Error("Post not found");
    error.statusCode = 404;
    error.code = "NOT_FOUND";
    throw error;
  }

  const comment = await prisma.communityComment.create({
    data: { postId, userId, content },
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });

  await prisma.communityPost.update({
    where: { id: postId },
    data: { commentsCount: post.commentsCount + 1 },
  });

  return comment;
}

export async function getTopContributors() {
  return prisma.contributor.findMany({
    orderBy: { postCount: "desc" },
    take: 10,
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });
}

export async function searchCommunityPosts(query: string) {
  return prisma.communityPost.findMany({
    where: {
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { user: { select: { id: true, name: true, avatar: true } } },
  });
}
