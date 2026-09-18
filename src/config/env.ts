import dotenv from "dotenv";
dotenv.config();

export const env = {
  PORT: Number(process.env.PORT) || 4000,
  DATABASE_URL: process.env.DATABASE_URL || "",
  JWT_SECRET: process.env.JWT_SECRET || (() => { throw new Error("JWT_SECRET is required in .env"); })(),
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID || "",
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || "",
  UPLOAD_DIR: process.env.UPLOAD_DIR || "./uploads",
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:3000",
  NODE_ENV: process.env.NODE_ENV || "development",
  API_URL: process.env.API_URL || "http://localhost:4000",
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  CONTACT_EMAIL: process.env.CONTACT_EMAIL || "guideme.cadt@gmail.com",

  // Shared secret used to verify the HMAC signature Bakong sends on payment
  // webhook callbacks (see routes/index.ts + middleware/verifyWebhookSignature.ts).
  // Must be set to a real value before the Bakong integration goes live —
  // left blank, the webhook route rejects every request rather than trusting
  // an unsigned payload.
  BAKONG_WEBHOOK_SECRET: process.env.BAKONG_WEBHOOK_SECRET || "",

  // ── Redis ──────────────────────────────────────────────────────────────────
  // Format: redis://:password@host:6379  or  rediss://... for TLS
  REDIS_URL: process.env.REDIS_URL || "",
  REDIS_DISABLED: process.env.REDIS_DISABLED === "true",

  // ── S3 / Cloudflare R2 — Audio CDN ────────────────────────────────────────
  // Leave blank to fall back to local-disk storage (development mode).
  S3_BUCKET: process.env.S3_BUCKET || "",
  S3_REGION: process.env.S3_REGION || "auto",
  S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID || "",
  S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY || "",
  // Cloudflare R2 endpoint, e.g. https://<accountid>.r2.cloudflarestorage.com
  // Leave empty to use standard AWS S3.
  S3_ENDPOINT: process.env.S3_ENDPOINT || "",
  // Public CDN base URL for generated audio files, e.g. https://cdn.guideme.app
  // Falls back to direct S3/R2 URL when unset.
  CDN_BASE_URL: process.env.CDN_BASE_URL || "",
};