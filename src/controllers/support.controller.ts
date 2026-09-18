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

export async function submitSalesLead(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { name, email, company, message } = req.body;
    const userId = (req as any).userId ?? null;
    const formattedMessage = `Business plan inquiry${company ? ` from ${company}` : ""}:\n\n${message}`;
    const ticket = await supportService.createSupportTicket(userId, {
      category: "sales",
      subject: `Business plan inquiry — ${name}`,
      message: formattedMessage,
      name,
      email,
    });
    res.status(201).json({ message: "Thanks — our team will reach out shortly.", id: ticket.id });
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
