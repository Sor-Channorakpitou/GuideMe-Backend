import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { env } from "../config/env.js";

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

/**
 * Verifies an HMAC-SHA256 signature on an incoming webhook body, comparing
 * against `BAKONG_WEBHOOK_SECRET`. Fails closed: if the secret isn't
 * configured, or the signature header is missing/mismatched, the request is
 * rejected rather than trusted (GM-001 — the webhook previously accepted any
 * unsigned POST and used its body to grant paid plan upgrades).
 *
 * Expects the signature in the `X-Bakong-Signature` header as a lowercase
 * hex-encoded HMAC-SHA256 digest of the raw request body. Adjust the header
 * name/encoding to match Bakong's actual webhook spec once available.
 */
export function verifyWebhookSignature(headerName: string) {
  return (req: RawBodyRequest, res: Response, next: NextFunction): void => {
    if (!env.BAKONG_WEBHOOK_SECRET) {
      res.status(503).json({
        error: { message: "Webhook not configured", code: "WEBHOOK_NOT_CONFIGURED" },
      });
      return;
    }

    const signature = req.header(headerName);
    if (!signature || !req.rawBody) {
      res.status(401).json({ error: { message: "Missing signature", code: "UNAUTHORIZED" } });
      return;
    }

    const expected = crypto
      .createHmac("sha256", env.BAKONG_WEBHOOK_SECRET)
      .update(req.rawBody)
      .digest("hex");

    const provided = Buffer.from(signature, "hex");
    const computed = Buffer.from(expected, "hex");

    if (provided.length !== computed.length || !crypto.timingSafeEqual(provided, computed)) {
      res.status(401).json({ error: { message: "Invalid signature", code: "UNAUTHORIZED" } });
      return;
    }

    next();
  };
}
