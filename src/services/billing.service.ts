import prisma from "../config/db.js";

export async function getCurrentBillingPlan(userId: string) {
  let billing = await prisma.billing.findUnique({ where: { userId } });
  if (!billing) {
    billing = await prisma.billing.create({
      data: { userId, plan: "FREE", status: "ACTIVE" },
    });
  }
  return billing;
}

export async function getBillingHistory(userId: string) {
  return prisma.billingHistory.findMany({
    where: { userId },
    orderBy: { date: "desc" },
  });
}

// Shared upgrade/downgrade logic used by two different callers with two
// different trust levels:
//   - The self-serve /api/billing/change-plan route (billing.routes.ts) only
//     ever allows "FREE" or "PRO" here — ENTERPRISE is rejected by that
//     route's own validator before a request body can reach this function.
//     PRO's "payment" is still mocked (no real Stripe/PayPal/Bakong charge
//     occurs) — an intentional, documented product decision for now, not an
//     oversight.
//   - The admin-only PATCH /api/admin/users/:userId/plan route (requires
//     adminAuth) can set ANY plan, including ENTERPRISE, after a Business
//     sales deal closes — see billing.controller.ts's adminSetPlan.
export async function changePlan(userId: string, plan: "FREE" | "PRO" | "ENTERPRISE") {
  const billing = await prisma.billing.upsert({
    where: { userId },
    update: {
      plan,
      status: "ACTIVE",
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    create: {
      userId,
      plan,
      status: "ACTIVE",
      nextBillingDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.user.update({ where: { id: userId }, data: { plan } });
  return billing;
}

export async function cancelSubscription(userId: string) {
  await prisma.billing.update({
    where: { userId },
    data: { status: "CANCELED" },
  });
  return { message: "Subscription canceled" };
}

export async function getPaymentMethods(userId: string) {
  return prisma.paymentMethod.findMany({ where: { userId } });
}

export async function addPaymentMethod(
  userId: string,
  data: { type: string; last4: string; expMonth: number; expYear: number }
) {
  await prisma.paymentMethod.updateMany({
    where: { userId },
    data: { isDefault: false },
  });

  return prisma.paymentMethod.create({
    data: {
      userId,
      type: data.type,
      last4: data.last4,
      expMonth: data.expMonth,
      expYear: data.expYear,
      isDefault: true,
    },
  });
}

export async function confirmStripePayment(userId: string) {
  const billing = await prisma.billing.findUnique({ where: { userId } });
  if (billing) {
    await prisma.billingHistory.create({
      data: {
        userId,
        plan: billing.plan,
        amount: billing.plan === "PRO" ? 2.99 : 29,
        status: "paid",
      },
    });
  }
  return { message: "Payment confirmed", success: true };
}

export async function capturePayPalPayment(userId: string) {
  const billing = await prisma.billing.findUnique({ where: { userId } });
  if (billing) {
    await prisma.billingHistory.create({
      data: {
        userId,
        plan: billing.plan,
        amount: billing.plan === "PRO" ? 2.99 : 29,
        status: "paid",
      },
    });
  }
  return { message: "PayPal order captured", success: true };
}

export async function verifyUserPayment(userId: string) {
  const history = await prisma.billingHistory.findFirst({
    where: { userId, status: "paid" },
    orderBy: { date: "desc" },
  });
  return { success: !!history };
}

export async function handleBakongWebhook(data: {
  userId: string;
  transactionId: string;
  amount: number;
  status: "completed" | "failed";
}) {
  if (data.status === "completed") {
    await prisma.billingHistory.create({
      data: {
        userId: data.userId,
        plan: "PRO",
        amount: data.amount,
        status: "paid",
      },
    });
    await prisma.billing.upsert({
      where: { userId: data.userId },
      update: { plan: "PRO", status: "ACTIVE" },
      create: { userId: data.userId, plan: "PRO", status: "ACTIVE" },
    });
    await prisma.user.update({ where: { id: data.userId }, data: { plan: "PRO" } });
  }
  return { received: true };
}
