import { v2 as cloudinary } from "cloudinary";
import multer from "multer";
import { env } from "../config/env.js";

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
});

export const uploadMiddleware = multer({ dest: env.UPLOAD_DIR });

export async function uploadFile(file: Express.Multer.File, folder = "guideme"): Promise<string> {
  if (!env.CLOUDINARY_CLOUD_NAME) {
    const cleanUploadDir = env.UPLOAD_DIR.replace(/^(\.\/|\/)+/, "").replace(/\/+$/, "");
    return `/${cleanUploadDir}/${file.filename}`;
  }

  const result = await cloudinary.uploader.upload(file.path, { folder });
  return result.secure_url;
}
