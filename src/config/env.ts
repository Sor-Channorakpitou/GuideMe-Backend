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
};