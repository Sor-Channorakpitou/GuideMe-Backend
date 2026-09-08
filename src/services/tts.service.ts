import crypto from "crypto";
import fs from "fs";
import path from "path";
import { env } from "../config/env.js";

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
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function synthesizeSpeech(options: TTSOptions): Promise<TTSResponse> {
  const language = options.language || "km";
  const speed = options.speed || "normal";
  const text = options.text.trim();

  // Create hash for file-based caching
  const hash = crypto.createHash("md5").update(`${language}:${speed}:${text}`).digest("hex");
  const uploadBasePath = path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.resolve(process.cwd(), env.UPLOAD_DIR);
  const audioDir = path.join(uploadBasePath, "audio");

  if (!fs.existsSync(audioDir)) {
    fs.mkdirSync(audioDir, { recursive: true });
  }

  const audioFilePath = path.join(audioDir, `${hash}.mp3`);
  const cleanUploadDir = env.UPLOAD_DIR.replace(/^(\.\/|\/)+/, "").replace(/\/+$/, "");
  const relativeAudioUrl = `/${cleanUploadDir}/audio/${hash}.mp3`;

  // Return cached file if already synthesized
  if (fs.existsSync(audioFilePath)) {
    return {
      audioUrl: relativeAudioUrl,
      text,
      language,
      speed,
      provider: "cached",
    };
  }

  // Generate SSML for speech synthesis
  const rateMap = { slow: "0.85", normal: "1.0", fast: "1.2" };
  const rate = rateMap[speed] || "1.0";
  const voiceName = language === "km" ? "km-KH-SreymomNeural" : "en-US-JennyNeural";

  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${
    language === "km" ? "km-KH" : "en-US"
  }"><voice name="${voiceName}"><prosody rate="${rate}">${escapeXml(text)}</prosody></voice></speak>`;

  // In production, an external Khmer TTS API (e.g. Azure / Edge / Google Cloud / Local Khmer FastSpeech) can be called here.
  // For standard environments, return the audio metadata + client-side Web Speech fallback format.
  return {
    audioUrl: undefined, // Browser Web Speech API or overlay player handles synthesis with SSML
    ssml,
    text,
    language,
    speed,
    provider: "browser-fallback",
  };
}
