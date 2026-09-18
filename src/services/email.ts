import { Resend } from "resend";
import { env } from "../config/env.js";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Escapes text before interpolating it into an HTML email template. The
 * contact-notification email below built its HTML from unescaped user
 * input (name/email/category/message on a public, unauthenticated
 * endpoint) — an attacker could inject arbitrary markup/links into the
 * email your staff reads.
 */
function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendContactNotification(data: {
  name: string;
  email: string;
  category: string;
  message: string;
}): Promise<void> {
  const { name, email, category, message } = data;

  if (!resend) {
    console.log(`[EMAIL] Support contact from ${name} <${email}>: ${category} - ${message}`);
    return;
  }

  await resend.emails.send({
    from: "GuideMe <onboarding@resend.dev>",
    to: env.CONTACT_EMAIL,
    subject: `[Support] ${escapeHtml(category)} - ${escapeHtml(name)}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a237e;">GuideMe Support Ticket</h2>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Name</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(name)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Email</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(email)}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Category</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(category)}</td></tr>
        </table>
        <h3>Message</h3>
        <p style="background:#f5f5f5;padding:12px;border-radius:8px;">${escapeHtml(message).replace(/\n/g, "<br>")}</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string
): Promise<void> {
  const resetUrl = `${env.CLIENT_URL}/reset-password?token=${token}`;

  if (!resend) {
    console.log(`[EMAIL] Password reset link for ${to}: ${resetUrl}`);
    return;
  }

  await resend.emails.send({
    from: "GuideMe <onboarding@resend.dev>",
    to,
    subject: "Reset your GuideMe password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a237e;">GuideMe</h2>
        <p>អ្នកបានស្នើសុំកំណត់ពាក្យសម្ងាត់ឡើងវិញ។</p>
        <p>You requested a password reset.</p>
        <a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#1a237e;color:#fff;text-decoration:none;border-radius:8px;margin:16px 0;">
          Reset Password
        </a>
        <p style="color:#666;font-size:12px;">This link expires in 15 minutes.</p>
      </div>
    `,
  });
}