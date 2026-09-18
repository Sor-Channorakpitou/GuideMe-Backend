import crypto from "crypto";
import fs from "fs";
import path from "path";
import { EdgeTTS } from "@seepine/edge-tts";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { redis, REDIS_KEY, REDIS_TTL } from "../config/redis.js";

export interface TTSOptions {
  text: string;
  language?: "km" | "en";
  speed?: "slow" | "normal" | "fast";
  voiceGender?: "female" | "male";
}

export interface TTSResponse {
  audioUrl?: string;
  text: string;
  language: string;
  speed: string;
  provider: "edge-tts" | "browser-fallback" | "cached";
  ssml?: string;
  subtitles?: Array<{ part: string; start: number; end: number }>;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── S3 / Cloudflare R2 client (lazy singleton) ───────────────────────────────
let _s3: S3Client | null = null;

function getS3Client(): S3Client | null {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    return null; // not configured — fall back to local disk
  }
  if (_s3) return _s3;

  const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
    region:      env.S3_REGION || "auto",
    credentials: {
      accessKeyId:     env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  };

  // Cloudflare R2 or any other S3-compatible provider
  if (env.S3_ENDPOINT) {
    clientConfig.endpoint = env.S3_ENDPOINT;
    clientConfig.forcePathStyle = true; // required for R2 and MinIO
  }

  _s3 = new S3Client(clientConfig);
  return _s3;
}

/**
 * Builds the public CDN URL for an audio file.
 * Priority: CDN_BASE_URL > S3_ENDPOINT-derived URL > local-disk URL.
 */
function buildPublicUrl(objectKey: string): string {
  if (env.CDN_BASE_URL) {
    return `${env.CDN_BASE_URL.replace(/\/+$/, "")}/${objectKey}`;
  }
  if (env.S3_ENDPOINT) {
    return `${env.S3_ENDPOINT.replace(/\/+$/, "")}/${env.S3_BUCKET}/${objectKey}`;
  }
  // Standard AWS S3 virtual-hosted URL
  return `https://${env.S3_BUCKET}.s3.${env.S3_REGION}.amazonaws.com/${objectKey}`;
}

/**
 * Upload audio buffer to S3 / R2.
 * Returns the public CDN URL on success, null on failure.
 */
async function uploadToS3(buffer: Buffer, objectKey: string): Promise<string | null> {
  const s3 = getS3Client();
  if (!s3) return null;

  try {
    // Skip upload if the object already exists (idempotent re-generation)
    try {
      await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
      return buildPublicUrl(objectKey); // already exists
    } catch (err: any) {
      const isNotFound = err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
      if (!isNotFound) {
        // Anything other than "doesn't exist yet" (AccessDenied, network
        // error, bucket ACL policy rejecting HeadObject, ...) is a real
        // misconfiguration — surface it instead of silently masking it as
        // "not found". We still proceed to PutObject below; if that's also
        // misconfigured it will fail loudly rather than silently degrading
        // to local disk on every single request.
        console.warn(`[TTS] HeadObject check failed for ${objectKey} (not a 404 — check S3 credentials/permissions):`, err?.name || err?.message);
      }
      // 404 (or unknown) — proceed with upload
    }

    await s3.send(new PutObjectCommand({
      Bucket:      env.S3_BUCKET,
      Key:         objectKey,
      Body:        buffer,
      ContentType: "audio/mpeg",
      // Make the object publicly readable for CDN delivery
      ACL:         "public-read",
      CacheControl: "public, max-age=2592000, immutable", // 30 days
    }));

    return buildPublicUrl(objectKey);
  } catch (err: any) {
    console.warn("[TTS S3] Upload failed:", err?.message || err);
    return null;
  }
}

// ── Local-disk helpers (development / S3-not-configured fallback) ─────────────
function ensureLocalAudioDir(): string {
  const uploadBasePath = path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.resolve(process.cwd(), env.UPLOAD_DIR);
  const audioDir = path.join(uploadBasePath, "audio");
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  return audioDir;
}

function buildLocalUrl(filename: string): string {
  const cleanUploadDir = env.UPLOAD_DIR.replace(/^(\.\/|\/)+/, "").replace(/\/+$/, "");
  return `${env.API_URL.replace(/\/+$/, "")}/${cleanUploadDir}/audio/${filename}`;
}

// ── Main synthesis function ───────────────────────────────────────────────────
export async function synthesizeSpeech(options: TTSOptions): Promise<TTSResponse> {
  const language = options.language || "km";
  const speed    = options.speed    || "normal";
  const gender   = options.voiceGender || "female";
  const text     = options.text.trim();

  // Deterministic hash — uniquely identifies this (text, language, speed, gender)
  // combination. This is a cache key, not a security boundary, so MD5's speed
  // is preferred; it also matches every audio file already synthesized and
  // cached under this key scheme (switching algorithms here would silently
  // orphan every previously cached file).
  const hash = crypto
    .createHash("md5")
    .update(`${language}:${speed}:${gender}:${text}`)
    .digest("hex");

  const objectKey = `audio/${hash}.mp3`;

  // ── Voice selection (Microsoft Edge Neural Voices) ────────────────────────
  let voiceName: string;
  if (language === "km") {
    voiceName = gender === "male" ? "km-KH-PisethNeural" : "km-KH-SreymomNeural";
  } else {
    voiceName = gender === "male" ? "en-US-GuyNeural" : "en-US-JennyNeural";
  }

  const rateMap: Record<string, string> = { slow: "-15%", normal: "+0%", fast: "+20%" };
  const ssmlRateMap: Record<string, string> = { slow: "0.85", normal: "1.0", fast: "1.2" };
  const langTag  = language === "km" ? "km-KH" : "en-US";
  const edgeRate = rateMap[speed] || "+0%";
  const ssmlRate = ssmlRateMap[speed] || "1.0";

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${langTag}"><voice name="${voiceName}"><prosody rate="${ssmlRate}">${escapeXml(text)}</prosody></voice></speak>`;

  const s3 = getS3Client();

  // ── Layer 1: Redis TTS URL cache ──────────────────────────────────────────
  const rKey = REDIS_KEY.ttsAudio(hash);
  const cachedUrl = await redis.get(rKey);
  if (cachedUrl) {
    if (s3) {
      // S3/R2-backed URLs persist independently of this server's filesystem
      // — safe to trust the cache directly.
      return { audioUrl: cachedUrl, text, language, speed, provider: "cached", ssml };
    }
    // Local-disk mode: the cached URL points at a file on *this* server's
    // disk, which a redeploy/restart with an ephemeral filesystem can wipe
    // while the Redis cache (an external, longer-lived store) survives.
    // Verify the file is actually still there before trusting a URL that
    // could otherwise 404 for up to REDIS_TTL.TTS_AUDIO (30 days).
    const cachedLocalPath = path.join(ensureLocalAudioDir(), `${hash}.mp3`);
    if (fs.existsSync(cachedLocalPath) && fs.statSync(cachedLocalPath).size > 0) {
      return { audioUrl: cachedUrl, text, language, speed, provider: "cached", ssml };
    }
    // Stale cache entry — fall through and regenerate below.
  }

  // ── Layer 2: S3 / R2 existence check (avoid re-synthesis for cached objects)
  if (s3) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: objectKey }));
      const audioUrl = buildPublicUrl(objectKey);
      // Backfill Redis cache so the next request skips S3 HeadObject too
      await redis.set(rKey, audioUrl, REDIS_TTL.TTS_AUDIO);
      return { audioUrl, text, language, speed, provider: "cached", ssml };
    } catch (err: any) {
      const isNotFound = err?.name === "NotFound" || err?.$metadata?.httpStatusCode === 404;
      if (!isNotFound) {
        console.warn(`[TTS] HeadObject check failed for ${objectKey} (not a 404 — check S3 credentials/permissions):`, err?.name || err?.message);
      }
      // 404 (or unknown) → not yet synthesized, continue
    }
  } else {
    // ── Layer 2b: Local disk existence check ──────────────────────────────
    const audioDir  = ensureLocalAudioDir();
    const localPath = path.join(audioDir, `${hash}.mp3`);
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 0) {
      const audioUrl = buildLocalUrl(`${hash}.mp3`);
      await redis.set(rKey, audioUrl, REDIS_TTL.TTS_AUDIO);
      return { audioUrl, text, language, speed, provider: "cached", ssml };
    }
  }

  // ── Layer 3: Synthesize via Edge TTS ─────────────────────────────────────
  try {
    const tts    = new EdgeTTS({ voice: voiceName, lang: langTag, rate: edgeRate });
    const result = await tts.call(text);

    if (result && result.data && result.data.length > 0) {
      const buffer = Buffer.from(result.data);
      let audioUrl: string | undefined;

      if (s3) {
        // Upload to S3/R2
        const s3Url = await uploadToS3(buffer, objectKey);
        if (s3Url) {
          audioUrl = s3Url;
          await redis.set(rKey, audioUrl, REDIS_TTL.TTS_AUDIO);
        }
      }

      if (!audioUrl) {
        // Fallback: write to local disk
        const audioDir  = ensureLocalAudioDir();
        const localPath = path.join(audioDir, `${hash}.mp3`);
        fs.writeFileSync(localPath, buffer);
        audioUrl = buildLocalUrl(`${hash}.mp3`);
        await redis.set(rKey, audioUrl, REDIS_TTL.TTS_AUDIO);
      }

      return {
        audioUrl,
        text,
        language,
        speed,
        provider: "edge-tts",
        ssml,
        subtitles: result.subtitles || [],
      };
    }
  } catch (err: any) {
    console.warn(`[TTS Service] Edge TTS synthesis failed for voice ${voiceName}:`, err?.message || err);
  }

  // ── Layer 4: Browser fallback (client-side Web Speech API) ───────────────
  return { audioUrl: undefined, ssml, text, language, speed, provider: "browser-fallback" };
}
