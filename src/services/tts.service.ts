import crypto from "crypto";
import fs from "fs";
import path from "path";
import { EdgeTTS } from "@seepine/edge-tts";
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

export async function synthesizeSpeech(options: TTSOptions): Promise<TTSResponse> {
  const language = options.language || "km";
  const speed = options.speed || "normal";
  const gender = options.voiceGender || "female";
  const text = options.text.trim();

  // Create hash for file-based caching
  const hash = crypto
    .createHash("md5")
    .update(`${language}:${speed}:${gender}:${text}`)
    .digest("hex");

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
  const fullAudioUrl = `${env.API_URL.replace(/\/+$/, "")}${relativeAudioUrl}`;

  // Voice selection (Microsoft Edge Neural Voices)
  let voiceName = "km-KH-SreymomNeural";
  if (language === "km") {
    voiceName = gender === "male" ? "km-KH-PisethNeural" : "km-KH-SreymomNeural";
  } else {
    voiceName = gender === "male" ? "en-US-GuyNeural" : "en-US-JennyNeural";
  }

  const rateMap: Record<string, string> = { slow: "-15%", normal: "+0%", fast: "+20%" };
  const edgeRate = rateMap[speed] || "+0%";
  const langTag = language === "km" ? "km-KH" : "en-US";

  // SSML generation for client-side playback, phonetics, and speech synthesis markup
  const ssmlRateMap = { slow: "0.85", normal: "1.0", fast: "1.2" };
  const ssmlRate = ssmlRateMap[speed] || "1.0";
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${langTag}"><voice name="${voiceName}"><prosody rate="${ssmlRate}">${escapeXml(
    text
  )}</prosody></voice></speak>`;

  // Return cached file if already synthesized
  if (fs.existsSync(audioFilePath) && fs.statSync(audioFilePath).size > 0) {
    return {
      audioUrl: fullAudioUrl,
      text,
      language,
      speed,
      provider: "cached",
      ssml,
    };
  }

  try {
    const tts = new EdgeTTS({
      voice: voiceName,
      lang: langTag,
      rate: edgeRate,
    });

    const result = await tts.call(text);
    if (result && result.data && result.data.length > 0) {
      fs.writeFileSync(audioFilePath, Buffer.from(result.data));
      return {
        audioUrl: fullAudioUrl,
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

  return {
    audioUrl: undefined,
    ssml,
    text,
    language,
    speed,
    provider: "browser-fallback",
  };
}
