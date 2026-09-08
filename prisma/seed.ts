import { PrismaClient, Plan, SubscriptionStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Clean existing data
  await prisma.supportTicket.deleteMany();
  await prisma.communityComment.deleteMany();
  await prisma.communityPost.deleteMany();
  await prisma.contributor.deleteMany();
  await prisma.billingHistory.deleteMany();
  await prisma.paymentMethod.deleteMany();
  await prisma.billing.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.userGuide.deleteMany();
  await prisma.guide.deleteMany();
  await prisma.appSetting.deleteMany();
  await prisma.notificationSetting.deleteMany();
  await prisma.user.deleteMany();

  const password = await bcrypt.hash("password123", 10);

  const user = await prisma.user.create({
    data: {
      name: "Sopheak Chan",
      email: "sopheak@example.com",
      password,
      phone: "+855 12 345 678",
      language: "km",
      plan: "PRO",
      emailVerified: true,
    },
  });

  await prisma.notificationSetting.create({
    data: { userId: user.id },
  });

  await prisma.appSetting.create({
    data: { userId: user.id },
  });

  await prisma.billing.create({
    data: {
      userId: user.id,
      plan: "PRO",
      status: "ACTIVE",
      nextBillingDate: new Date("2026-09-01"),
    },
  });

  await prisma.paymentMethod.create({
    data: {
      userId: user.id,
      type: "visa",
      last4: "4242",
      expMonth: 12,
      expYear: 2028,
      isDefault: true,
    },
  });

  await prisma.billingHistory.create({
    data: {
      userId: user.id,
      plan: "PRO",
      amount: 9.0,
      status: "paid",
      date: new Date("2026-08-01"),
      invoiceUrl: "#",
    },
  });

  const guide1 = await prisma.guide.create({
    data: {
      title: "Google Workspace",
      description: "រៀនប្រើ Google Workspace មួយជំហានម្តងៗ",
      category: "workspace",
      steps: JSON.stringify([
        "Open Google Drive",
        "Create a new document",
        "Share the document",
        "Add collaborators",
        "Set permissions",
        "Use comments",
        "Download as PDF",
        "Organize into folders",
        "Version history",
        "Publish to web",
      ]),
    },
  });

  const guide2 = await prisma.guide.create({
    data: {
      title: "Facebook Setup",
      description: "ការកំណត់រចនាសម្ព័ន្ធ Facebook",
      category: "social",
      steps: JSON.stringify([
        "Create account",
        "Set up profile",
        "Find friends",
        "Create a post",
      ]),
    },
  });

  await prisma.userGuide.create({
    data: {
      userId: user.id,
      guideId: guide1.id,
      currentStep: 7,
      totalSteps: 10,
      completed: false,
    },
  });

  await prisma.activity.createMany({
    data: [
      {
        userId: user.id,
        type: "guide_completed",
        guideId: guide1.id,
        description: "បានបញ្ចប់ Google Workspace Guide",
      },
      {
        userId: user.id,
        type: "guide_started",
        guideId: guide2.id,
        description: "បានចាប់ផ្តើម Facebook Setup Guide",
      },
    ],
  });

  const post = await prisma.communityPost.create({
    data: {
      userId: user.id,
      category: "គន្លឹះ",
      title: "របៀបប្រើ Google Drive ឱ្យមានប្រសិទ្ធភាព",
      description: "ការចែករំលែកឯកសារជាមួយអ្នកដទៃអាចធ្វើឱ្យការងាររបស់អ្នកកាន់តែងាយស្រួល...",
      likes: 12,
      likedBy: [],
      commentsCount: 3,
    },
  });

  await prisma.communityComment.create({
    data: {
      postId: post.id,
      userId: user.id,
      content: "អរគុណសម្រាប់គន្លឹះល្អៗ!",
    },
  });

  await prisma.contributor.create({
    data: {
      userId: user.id,
      postCount: 1,
      role: "member",
    },
  });

  console.log("✅ Seed completed successfully");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
