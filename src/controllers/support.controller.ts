import { Request, Response, NextFunction } from "express";
import * as supportService from "../services/support.service.js";

export async function submitContact(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { category, subject, message, name, email } = req.body;
    const userId = (req as any).userId ?? null;
    const ticket = await supportService.createSupportTicket(userId, { category, subject, message, name, email });
    res.status(201).json(ticket);
  } catch (err) {
    next(err);
  }
}

export async function getFaq(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const category = req.query.category as string | undefined;
    const faq = supportService.getFaqList(category);
    res.json(faq);
  } catch (err) {
    next(err);
  }
}
