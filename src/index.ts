import path from "path";
import express, { Request, Response } from "express";
import cors, { CorsOptions } from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env.js";
import { swaggerSpec } from "./config/swagger.js";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";

const app = express();

// 1. Define allowed web domains
const allowedWebOrigins = [
  env.CLIENT_URL,
  process.env.CLIENT_URL,
  "http://localhost:3000",
  "http://localhost:5173",
  "https://guideme-lac.vercel.app",
].filter(Boolean) as string[];

// 2. Production Extension ID
const PRODUCTION_EXTENSION_ID = process.env.EXTENSION_ID || "gkkgcgloiohdceccgepkfkecpgcgpiom";

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Universal Tutorial Engine requires cross-origin access from any website where the extension runs.
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(helmet({
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors(corsOptions));
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", routes);

// Serve static assets from UPLOAD_DIR (e.g. avatars, cached TTS audio)
const uploadBasePath = path.isAbsolute(env.UPLOAD_DIR)
  ? env.UPLOAD_DIR
  : path.resolve(process.cwd(), env.UPLOAD_DIR);
const cleanUploadRoute = "/" + env.UPLOAD_DIR.replace(/^(\.\/|\/)+/, "").replace(/\/+$/, "");
app.use(cleanUploadRoute, express.static(uploadBasePath));

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: ".swagger-ui .topbar { display: none }",
  customSiteTitle: "GuideMe API Docs",
  swaggerOptions: { persistAuthorization: true },
}));

// Expose Swagger raw JSON endpoint for automated type sync & external tools
app.get(["/api/swagger.json", "/api-docs.json"], (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});

app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Server running on ${env.API_URL}`);
  console.log(`Swagger UI at ${env.API_URL}/api-docs`);
});

export default app;