import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Request } from "express";

/**
 * Per-account (not just per-IP) throttling for auth-sensitive routes
 * (login, register, forgot-password, reset-password). The app-wide limiter
 * in index.ts (100 req / 15 min / IP) is the only protection these routes
 * had before — trivially bypassed by rotating IPs, and it doesn't stop a
 * single IP from brute-forcing many different accounts either, since it
 * counts all routes together (GM-009).
 *
 * Keyed on IP + the submitted email so:
 *  - many failed guesses against ONE account from ANY IP get throttled, and
 *  - one IP hammering MANY different accounts still gets throttled per IP.
 */
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    // express-rate-limit v8 requires IPv6 addresses to go through its own
    // normalization helper — a raw req.ip string has multiple equivalent
    // textual forms for the same IPv6 address, which would let a user
    // sidestep the limit just by requesting from a differently-formatted
    // (but identical) address. This threw a startup ValidationError before
    // this fix.
    return `${ipKeyGenerator(req.ip || "")}:${email}`;
  },
  message: {
    error: {
      message: "Too many attempts. Please wait a few minutes and try again.",
      code: "TOO_MANY_ATTEMPTS",
    },
  },
});
