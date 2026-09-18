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

// ── Process-level crash prevention ──
process.on("unhandledRejection", (reason) => {
  console.error("[FATAL] Unhandled rejection:", reason instanceof Error ? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err.message);
  // Give logger time to flush, then exit hard
  setTimeout(() => process.exit(1), 1000).unref();
});

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

// Chrome Extension content scripts run in the host page's origin (e.g.
// https://docs.google.com), not a chrome-extension:// origin, and the
// extension may be active on any arbitrary website — so we still allow
// cross-origin *requests* from any origin. That content-script traffic
// authenticates via the `Authorization: Bearer` header (see
// middleware/auth.ts), which is never sent automatically by the browser, so
// it cannot be replayed by a hostile page the way an ambient cookie can.
//
// The extension's OWN origin (`chrome-extension://<PRODUCTION_EXTENSION_ID>`)
// is different: unlike a content-script's host-page origin, no arbitrary
// webpage can ever present that Origin value — only the real background
// service worker / popup running under that exact extension ID can — so it
// is safe to trust with credentials the same as the first-party web app.
//
// The `credentials: true` cookie-echo flag (which makes the browser both
// attach the httpOnly session cookie AND let the caller read the response)
// is reflected ONLY for those known, unforgeable origins. Any other origin
// (including an arbitrary content-script host page) gets `credentials:
// false`, so for the JSON POST/PUT/PATCH/DELETE requests this API mostly
// serves (which require a CORS preflight), the browser refuses to send the
// cookie-bearing request at all once the preflight response reports
// credentials are not allowed — closing the cross-site cookie-replay / CSRF
// hole (GM-004) without breaking Bearer-token auth for content scripts or
// cookie auth for the extension's own privileged pages.
const credentialedOrigins = [...allowedWebOrigins, `chrome-extension://${PRODUCTION_EXTENSION_ID}`];

const corsOptionsDelegate = (
  req: Request,
  callback: (err: Error | null, options?: CorsOptions) => void
): void => {
  const origin = req.header("Origin");
  const isCredentialedOrigin = !!origin && credentialedOrigins.includes(origin);

  callback(null, {
    origin: true,
    credentials: isCredentialedOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  });
};

app.use(helmet({
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors(corsOptionsDelegate));
app.use(morgan("dev"));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
// Capture the raw request body alongside the parsed JSON so webhook routes
// can verify an HMAC signature computed over the exact bytes that were sent.
app.use(express.json({
  verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
    req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use("/api", routes);
app.use("/api/v1", routes);

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