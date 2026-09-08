import { Response, NextFunction } from "express";
import { AuthRequest } from "../middleware/auth.js";
import * as billingService from "../services/billing.service.js";

export async function getCurrentPlan(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const billing = await billingService.getCurrentBillingPlan(req.userId!);
    res.json(billing);
  } catch (err) {
    next(err);
  }
}

export async function getBillingHistory(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const history = await billingService.getBillingHistory(req.userId!);
    res.json(history);
  } catch (err) {
    next(err);
  }
}

export async function changePlan(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { plan } = req.body;
    const billing = await billingService.changePlan(req.userId!, plan);
    res.json(billing);
  } catch (err) {
    next(err);
  }
}

export async function cancelSubscription(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await billingService.cancelSubscription(req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function getPaymentMethods(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const methods = await billingService.getPaymentMethods(req.userId!);
    res.json(methods);
  } catch (err) {
    next(err);
  }
}

export async function updatePaymentMethod(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { type, last4, expMonth, expYear } = req.body;
    const method = await billingService.addPaymentMethod(req.userId!, { type, last4, expMonth, expYear });
    res.json(method);
  } catch (err) {
    next(err);
  }
}

export async function createPaymentIntent(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ clientSecret: "mock_secret_" + Date.now(), amount: 900, currency: "usd" });
  } catch (err) {
    next(err);
  }
}

export async function confirmPayment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await billingService.confirmStripePayment(req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function createPayPalOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ approvalUrl: "https://www.paypal.com/checkout?token=mock_token", token: "mock_token" });
  } catch (err) {
    next(err);
  }
}

export async function capturePayPalOrder(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await billingService.capturePayPalPayment(req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function verifyPayment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await billingService.verifyUserPayment(req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function bakongWebhook(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId, transactionId, amount, status } = req.body;
    const result = await billingService.handleBakongWebhook({ userId, transactionId, amount, status });
    res.json(result);
  } catch (err) {
    next(err);
  }
}
