import crypto from "crypto";
import {
  hardenAndValidateTutorial,
  AIGuideResponseSchema,
  IntentRerankResponseSchema,
  ContextualAssistantResponseSchema,
} from "./ai-schema.validator.js";
import { redis, REDIS_KEY, REDIS_TTL } from "../config/redis.js";

/**
 * Recursively sorts object keys (arrays keep their original order — element
 * order can be semantically meaningful) so two objects with the same content
 * but different key insertion order serialize identically.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Deterministic cache key for a guide-step generation request: the same
 * intent against the same DOM snapshot always hashes to the same key, so a
 * cache hit returns the exact previous result instead of re-sampling the
 * LLM (which — even at temperature 0 — is the only way to guarantee two
 * identical requests never produce two different guides).
 */
export function guideStepsCacheKey(parts: Record<string, unknown>): string {
  const canonical = JSON.stringify(canonicalize({ ...parts, promptVersion: GUIDE_PROMPT_VERSION }));
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Merges a "click to focus this field" step immediately followed by a
 * "type into it" step when both target the exact same element, into a
 * single input-type step. The system prompt already asks the LLM not to
 * split these in the first place, but that's a prose rule the model doesn't
 * always follow — this makes it a guarantee instead of a hope.
 *
 * Why this matters beyond redundancy: for elements with no real DOM
 * presence beyond one shared editable proxy (e.g. a spreadsheet's formula
 * bar standing in for whichever cell is selected), the two steps resolve to
 * the literal same on-screen box, so the spotlight visibly does not move
 * between them — which reads as a stuck/broken overlay, not as two
 * completed actions.
 */
export function mergeRedundantFocusThenTypeSteps(steps: any[]): any[] {
  if (!Array.isArray(steps) || steps.length < 2) return steps;

  const targetKey = (t: any) => {
    if (!t || typeof t !== "object") return null;
    return JSON.stringify({ css: t.css || "", text: t.text || "", ariaLabel: t.ariaLabel || "" });
  };

  const merged: any[] = [];
  for (let i = 0; i < steps.length; i++) {
    const current = steps[i];
    const next = steps[i + 1];
    const currentIsClick = current?.validation?.type === "click";
    const nextIsTypeInto = next?.validation?.type === "input" || next?.validation?.type === "change";
    const sameTarget = targetKey(current?.target) && targetKey(current?.target) === targetKey(next?.target);

    if (currentIsClick && nextIsTypeInto && sameTarget) {
      // Keep the typing step's identity (title/instruction/validation are the
      // real action) but preserve the click step's id for ordering.
      merged.push({ ...next, id: current.id ?? next.id });
      i++; // consume the next step too
      continue;
    }
    merged.push(current);
  }

  return merged;
}

/**
 * Bump this whenever generateSteps'/generateDomGuideSteps' system prompt
 * text OR any server-side post-processing of their output (e.g.
 * mergeRedundantFocusThenTypeSteps) changes in a way that could change the
 * result for an already-cached request. Without this, an old cached response
 * (e.g. one containing a fabricated cell range like "D2:D10" from before a
 * prompt fix, or un-merged redundant steps from before a post-processing
 * fix) keeps being served for up to REDIS_TTL.GUIDE_STEPS regardless of the
 * fix, since the cache key is otherwise only a function of the user-facing
 * inputs (prompt/DOM snapshot), not of our own prompt template or code.
 */
const GUIDE_PROMPT_VERSION = 4;

/**
 * Per-provider timeout for interactive, UX-blocking guide generation
 * (generateSteps / generateDomGuideSteps) specifically. Deliberately NOT
 * the shared GEMINI_TIMEOUT_MS — that env var is also read by
 * askContextualAssistant/rerankIntentCandidates/validateIntent, which can
 * reasonably afford to wait longer than a user staring at a loading
 * spinner waiting for their guide to appear.
 *
 * 12s, not 8s: OpenRouter/Gemini running a real generate-steps prompt
 * (larger system prompt + full DOM element list) routinely takes longer
 * than 8s to finish even on a healthy run, so 8s was timing out legitimate
 * in-flight responses, not just genuinely-stuck ones. Since all providers
 * now race in parallel instead of running one after another, raising this
 * back up no longer reintroduces the old ~50s worst-case pileup — the
 * total wait is still bounded by the single slowest attempt.
 */
const GUIDE_GENERATION_TIMEOUT_MS = Number(process.env.GUIDE_GENERATION_TIMEOUT_MS) || 12000;

/**
 * Resolves with the first promise that fulfills to a non-null value.
 * Promises that reject or fulfill to null/undefined are ignored (not
 * allowed to end the race) until every promise has settled that way, at
 * which point this resolves to null. Used to run OpenRouter and every
 * Gemini key attempt concurrently instead of one-after-another: total wait
 * becomes the SLOWEST attempt instead of the SUM of every attempt, which
 * is what made a run where every provider times out feel like it hung.
 */
function firstNonNull<T>(promises: Promise<T | null>[]): Promise<T | null> {
  return new Promise((resolve) => {
    if (promises.length === 0) {
      resolve(null);
      return;
    }
    let remaining = promises.length;
    for (const p of promises) {
      p.then((value) => {
        if (value !== null && value !== undefined) {
          resolve(value);
        } else if (--remaining === 0) {
          resolve(null);
        }
      }).catch(() => {
        if (--remaining === 0) resolve(null);
      });
    }
  });
}

/**
 * Escapes raw control characters (literal newlines, tabs, carriage returns)
 * that appear *inside* JSON string literals. LLMs frequently emit multi-line
 * prose in a string value without escaping the line breaks as \n, which is
 * invalid per the JSON spec and makes JSON.parse throw "Unterminated string".
 * Leaves whitespace outside of strings untouched.
 */
function sanitizeJsonControlChars(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        result += ch;
        escaped = false;
      } else if (ch === "\\") {
        result += ch;
        escaped = true;
      } else if (ch === '"') {
        result += ch;
        inString = false;
      } else if (ch === "\n") {
        result += "\\n";
      } else if (ch === "\r") {
        result += "\\r";
      } else if (ch === "\t") {
        result += "\\t";
      } else {
        result += ch;
      }
    } else {
      if (ch === '"') inString = true;
      result += ch;
    }
  }
  return result;
}

/**
 * Removes stray commas that make otherwise well-formed JSON unparsable:
 * a comma immediately after `{`/`[` (e.g. `{,"a":1}`) or immediately before
 * `}`/`]` (e.g. `{"a":1,}`). Both are common LLM hallucination artifacts,
 * especially from faster/smaller models. Ignores commas inside string
 * literals so real string content is never touched.
 */
function stripStrayCommas(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      result += ch;
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      result += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === "}" || text[j] === "]") continue; // trailing comma
      let k = result.length - 1;
      while (k >= 0 && /\s/.test(result[k])) k--;
      if (result[k] === "{" || result[k] === "[") continue; // leading comma
    }
    result += ch;
  }
  return result;
}

/**
 * Strips reasoning tokens (<think>...</think>) and markdown code fences from LLM responses.
 */
export function cleanJsonResponse(rawText: string): string {
  if (!rawText) return "";
  // Strip DeepSeek-style <think>...</think> reasoning blocks first
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // Strip markdown code fences
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const extracted = fenceMatch
    ? fenceMatch[1].trim()
    : (cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/)?.[1].trim() ?? cleaned);
  return stripStrayCommas(sanitizeJsonControlChars(extracted));
}

export interface GeneratedStep {
  stepNumber: number;
  title: string;
  instruction: string;
  hint?: string;
  targetElement?: string;
}

export interface AIGuideResponse {
  title: string;
  description: string;
  category: string;
  steps: GeneratedStep[];
}

export interface DomElementSummary {
  tag: string;
  id: string;
  className: string;
  text: string;
  type: string;
  role: string;
  ariaLabel: string;
  placeholder: string;
  name: string;
  selector: string;
  href: string;
  rect: { x: number; y: number; width: number; height: number };
  isVisible: boolean;
}

export interface GenerateStepsRequest {
  prompt: string;
  language: string;
  elements: DomElementSummary[];
  url: string;
}

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  target: {
    css?: string;
    testId?: string;
    ariaLabel?: string;
    text?: string;
  };
  action: {
    type: string;
    title: string;
    content: string;
    placement: string;
  };
  validation: {
    type: string;
  };
}

export interface GenerateStepsResponse {
  done?: boolean;
  tutorial: {
    id: string;
    version: string;
    name: string;
    description: string;
    steps: TutorialStep[];
  };
}

/**
 * Resolves all configured Gemini API keys from environment.
 * Supports GEMINI_API_KEY, GEMINI_API_KEY_2, comma-separated GEMINI_API_KEYS, and AI_API_KEY.
 */
export function getGeminiApiKeys(): string[] {
  const keys: string[] = [];
  if (process.env.GEMINI_API_KEYS) {
    keys.push(...process.env.GEMINI_API_KEYS.split(",").map((k) => k.trim()).filter(Boolean));
  }
  if (process.env.GEMINI_API_KEY && !keys.includes(process.env.GEMINI_API_KEY.trim())) {
    keys.push(process.env.GEMINI_API_KEY.trim());
  }
  if (process.env.GEMINI_API_KEY_2 && !keys.includes(process.env.GEMINI_API_KEY_2.trim())) {
    keys.push(process.env.GEMINI_API_KEY_2.trim());
  }
  if (process.env.AI_API_KEY && !keys.includes(process.env.AI_API_KEY.trim())) {
    keys.push(process.env.AI_API_KEY.trim());
  }
  return keys;
}

let geminiKeyCounter = 0;

/**
 * Returns configured Gemini API keys ordered for the current request.
 * Alternates which key is tried first on every call (round-robin), while keeping the
 * remaining key(s) as automatic failovers if the primary hits 429 quota or 503 errors.
 */
export function getOrderedGeminiApiKeys(): string[] {
  const keys = getGeminiApiKeys();
  if (keys.length === 0) return [];
  const startIdx = geminiKeyCounter % keys.length;
  geminiKeyCounter = (geminiKeyCounter + 1) % keys.length;
  return [...keys.slice(startIdx), ...keys.slice(0, startIdx)];
}

export function resetGeminiKeyCounter(): void {
  geminiKeyCounter = 0;
}

/**
 * Resolves OpenRouter / Universal OpenAI-compatible endpoint configuration.
 * Prioritizes WXT_AI_API_KEY / OPENROUTER_API_KEY from environment.
 *
 * `planTier` CAN pick a cheaper model for FREE-plan requests via the
 * OPENROUTER_MODEL_FREE env var — but the default (when that var is unset)
 * is to use the SAME full model for every plan. This was deliberately
 * flipped from an earlier version that defaulted FREE to a lite model:
 * Khmer is a low-resource language, GuideMe's audience is specifically
 * low-digital-literacy users who can't easily notice or recover from subtly
 * wrong guidance, and general LLM research shows low-resource-language
 * accuracy gaps between model tiers are typically LARGER than for
 * high-resource languages — this isn't a validated trade-off to make by
 * default. Set OPENROUTER_MODEL_FREE explicitly to opt into the cost saving
 * once you've actually tested Khmer quality on the cheaper model.
 */
export function getOpenRouterConfig(
  planTier?: string
): { apiKey: string; model: string; endpoint: string; timeoutMs: number } | null {
  const apiKey = (process.env.OPENROUTER_API_KEY || process.env.WXT_AI_API_KEY || "").trim();
  if (!apiKey) return null;
  const endpoint = (process.env.OPENROUTER_BASE_URL || process.env.WXT_AI_ENDPOINT || "https://openrouter.ai/api/v1/chat/completions").trim();

  const isPaidTier = planTier === "PRO" || planTier === "ENTERPRISE";
  const fullModel = process.env.OPENROUTER_MODEL || process.env.WXT_AI_MODEL || "google/gemini-3.5-flash";
  const model = isPaidTier ? fullModel : (process.env.OPENROUTER_MODEL_FREE || fullModel);

  const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS) || 12000;
  return { apiKey, model: model.trim(), endpoint, timeoutMs };
}

export async function generateGuideSteps(
  prompt: string,
  category = "general",
  language = "km",
  planTier?: string
): Promise<AIGuideResponse> {
  const openRouter = getOpenRouterConfig(planTier);

  // 1. Try OpenRouter Universal AI Gateway (Top Priority)
  if (openRouter) {
    try {
      const systemInstruction = `You are an expert digital literacy tutor in Cambodia for the GuideMe application.
Generate a step-by-step interactive tutorial based on this user prompt: "${prompt}".
Language requested: ${language === "km" ? "Khmer (ភាសាខ្មែរ)" : "English"}.
Category: ${category}.

You MUST return ONLY valid JSON adhering strictly to this schema:
{
  "title": "Tutorial Title",
  "description": "Brief summary",
  "category": "${category}",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Step Title",
      "instruction": "Clear, friendly step-by-step instruction",
      "hint": "Helpful tip for elderly or beginner users",
      "targetElement": "button, input, or UI element description"
    }
  ]
}`;

      const response = await fetch(openRouter.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openRouter.apiKey}`,
          "HTTP-Referer": "https://guideme.cadt.edu.kh",
          "X-Title": "GuideMe Interactive Walkthrough",
        },
        body: JSON.stringify({
          model: openRouter.model,
          messages: [{ role: "user", content: systemInstruction }],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 4096,
          // This model is a reasoning/thinking model on OpenRouter — reasoning
          // is mandatory and cannot be disabled, but "minimal" effort keeps it
          // from burning the whole token budget (and 10+ seconds of latency)
          // on invisible chain-of-thought before ever emitting the JSON answer.
          reasoning: { effort: "minimal" },
        }),
        signal: AbortSignal.timeout(openRouter.timeoutMs),
      });

      if (response.ok) {
        const data: any = await response.json();
        const contentText = data.choices?.[0]?.message?.content;
        if (contentText) {
          const cleaned = cleanJsonResponse(contentText);
          const parsed = JSON.parse(cleaned);
          const validated = AIGuideResponseSchema.safeParse(parsed);
          if (validated.success) {
            return validated.data as AIGuideResponse;
          }
        }
      } else {
        const errText = await response.text().catch(() => "");
        console.warn(`[AI Service] OpenRouter guide generation returned HTTP ${response.status}:`, errText.slice(0, 150));
      }
    } catch (err: any) {
      console.warn("[AI Service] OpenRouter guide generation error, falling back to Gemini:", err?.message);
    }
  }

  // 2. Try Gemini (Rotating Pool)
  const geminiKeys = getOrderedGeminiApiKeys();

  if (geminiKeys.length > 0) {
    // Cap the sequential fallback to 2 keys — enough to cover a single
    // quota-exhausted key without stacking unbounded per-key timeouts.
    for (const apiKey of geminiKeys.slice(0, 2)) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `You are an expert digital literacy tutor in Cambodia for the GuideMe application.
Generate a step-by-step interactive tutorial based on this user prompt: "${prompt}".
Language requested: ${language === "km" ? "Khmer (ភាសាខ្មែរ)" : "English"}.
Category: ${category}.

You MUST return ONLY valid JSON adhering strictly to this schema:
{
  "title": "Tutorial Title",
  "description": "Brief summary",
  "category": "${category}",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Step Title",
      "instruction": "Clear, friendly step-by-step instruction",
      "hint": "Helpful tip for elderly or beginner users",
      "targetElement": "button, input, or UI element description"
    }
  ]
}`,
                  },
                ],
              },
            ],
            generationConfig: { responseMimeType: "application/json", maxOutputTokens: 4096 },
          }),
          signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS) || 3000),
        }
      );

      if (response.ok) {
        const data: any = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (jsonText) {
          const cleaned = cleanJsonResponse(jsonText);
          const parsed = JSON.parse(cleaned);
          const validated = AIGuideResponseSchema.safeParse(parsed);
          if (validated.success) {
            return validated.data as AIGuideResponse;
          }
        }
      }
    } catch (err) {
      console.warn("[AI Service] Gemini API call failed, falling back to smart generation template:", err);
    }
  }
  }

  // Smart fallback generator for offline or dev mode
  return generateFallbackGuide(prompt, category, language);
}


export interface AssistantIntentInstruction {
  targetQuery: string;
  action: "click" | "input" | "change" | "submit";
  role?: "button" | "input" | "link" | "tab" | "menuitem" | "element";
  category?: string;
  expectedInput?: string;
}

/**
 * Extracts a structured AssistantIntentInstruction from user question or intentPrompt.
 * Serves as a deterministic zero-failure safety net if an LLM sets triggerGuide=true but returns intent=null.
 */
export function extractIntentFromPrompt(
  question: string,
  intentPrompt?: string | null
): AssistantIntentInstruction {
  const text = `${question} ${intentPrompt || ""}`.toLowerCase();

  // ── Category detection: English + expanded Khmer synonyms ──
  const isShare   = /\b(share|collaborat|invite|distribut|broadcast|publish)\b|(ចែករំលែក|ចែករំ|ផ្ញើ\s*តំណ|ផ្សព្វផ្សាយ|ផ្ញើ\s*ឯកសារ)/i.test(text);
  const isSearch  = /\b(search|find|lookup|query|explore|browse|filter)\b|(ស្វែងរក|ស្វែង|រក\s*ឃើញ|ស្ទង)/i.test(text);
  const isAuth    = /\b(login|log\s*in|sign\s*in|signin|register|signup|auth)\b|(ចូល\s*គណនី|ចូល\s*ប្រព័ន្ធ|ចុះឈ្មោះ)/i.test(text);
  const isSettings = /\b(settings?|preference|config|profile|account)\b|(ការកំណត់|កំណត់|គណនី|ប្រូហ្វាល់)/i.test(text);
  const isExport  = /\b(export|download|save|print)\b|(ទាញយក|ទាញ\s*ចុះ|រក្សា\s*ទុក|បោះ\s*ពុម្ព)/i.test(text);
  const isNew     = /\b(new|create|add|\+|compose|upload)\b|(បង្កើត|បន្ថែម|បង្ហោះ|ផ្ទុក\s*ឡើង|ថ្មី)/i.test(text);
  const isEdit    = /\b(edit|modify|change|rename|update)\b|(កែ\s*ប្រែ|ផ្លាស់\s*ប្ដូរ|ប្តូរ\s*ឈ្មោះ)/i.test(text);
  const isDelete  = /\b(delete|remove|trash|discard)\b|(លុប\s*ចោល|លុប|ដក\s*ចេញ)/i.test(text);
  const isSend    = /\b(send|submit|post)\b|(ផ្ញើ(?!\s*តំណ)|ដាក់\s*ស្នើ)/i.test(text);

  if (isShare)    return { targetQuery: "Share",    action: "click", role: "button", category: "share" };
  if (isSearch)   return { targetQuery: "Search",   action: "input", role: "input",  category: "search" };
  if (isAuth)     return { targetQuery: "Sign In",  action: "click", role: "button", category: "auth" };
  if (isSettings) return { targetQuery: "Settings", action: "click", role: "button", category: "navigation" };
  if (isExport)   return { targetQuery: "Export",   action: "click", role: "button", category: "general" };
  if (isNew)      return { targetQuery: "New",      action: "click", role: "button", category: "general" };
  if (isEdit)     return { targetQuery: "Edit",     action: "click", role: "button", category: "general" };
  if (isDelete)   return { targetQuery: "Delete",   action: "click", role: "button", category: "general" };
  if (isSend)     return { targetQuery: "Send",     action: "click", role: "button", category: "general" };

  // ── Strip conversational wrappers ──
  // English: "please help me to ...", "show me how to ...", "can you open ...", etc.
  // Khmer:   "ជួយខ្ញុំ...", "សូម...", "តើ...?", "ខ្ញុំចង់...", "ណែនាំ...", etc.
  const stripped = (intentPrompt || question)
    .replace(/^(yes\s+)?(please\s+)?(help\s+me\s+)?(to\s+)?(get\s+the\s+link\s+to\s+)?(how\s+to\s+)?(can\s+you\s+)?(show\s+me\s+)?(click\s+)?(open\s+)?(find\s+)?/i, "")
    .replace(/^(ជួយ\s*ខ្ញុំ\s*|ជួយ\s*|សូម\s*|តើ\s*|ខ្ញុំ\s*ចង់\s*|ខ្ញុំ\s*ត្រូវការ\s*|ខ្ញុំ\s*|ចង់\s*|ណែនាំ\s*ខ្ញុំ\s*|ណែនាំ\s*|ត្រូវការ\s*|អាច\s*|ចង់\s*ដឹង\s*)/, "")
    .trim();

  // ── Khmer-only input: map common UI nouns to English equivalents for DOM matching ──
  const khmerToEnglish: Record<string, string> = {
    "ចូល": "Sign In", "ចុះឈ្មោះ": "Register", "ចែករំលែក": "Share",
    "ស្វែងរក": "Search", "ការកំណត់": "Settings", "កំណត់": "Settings",
    "ទាញយក": "Download", "ផ្ញើ": "Send", "បង្កើត": "Create",
    "លុប": "Delete", "កែ": "Edit", "បន្ថែម": "Add", "ផ្ទុក": "Upload",
    "ទំព័រ": "Home", "គណនី": "Account", "ប្រូហ្វាល់": "Profile",
    "ចេញ": "Sign Out", "ណែនាំ": "Guide", "ផ្លាស់ប្ដូរ": "Change",
    "ចុច": "Click", "បើក": "Open", "ទៅ": "Go",
  };
  for (const [km, en] of Object.entries(khmerToEnglish)) {
    if (stripped.includes(km)) {
      return { targetQuery: en, action: km === "ស្វែងរក" ? "input" : "click", role: km === "ស្វែងរក" ? "input" : "button", category: "general" };
    }
  }

  // ── If still Khmer-script, return the first Khmer word cluster for the DOM reranker ──
  const khmerMatch = stripped.match(/[\u1780-\u17FF]+/u);
  if (khmerMatch && khmerMatch[0].length >= 2) {
    return { targetQuery: khmerMatch[0], action: "click", role: "button", category: "general" };
  }

  // ── Latin/mixed: take the first meaningful word as the UI label ──
  const words = stripped.replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).filter((w) => w.length >= 3);
  const targetQuery = words[0] ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : "Action";

  return { targetQuery, action: "click", role: "button", category: "general" };
}
export async function askContextualAssistant(
  question: string,
  context?: { guideTitle?: string; currentStep?: number; stepInstruction?: string },
  language = "km",
  image?: string,
  planTier?: string
): Promise<{ answer: string; triggerGuide: boolean; intentPrompt?: string; intent?: AssistantIntentInstruction | null; relatedTips?: string[] }> {
  const geminiKeys = getOrderedGeminiApiKeys();

  let imageInlineData: { mimeType: string; data: string } | null = null;
  if (image) {
    const match = image.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      imageInlineData = { mimeType: match[1], data: match[2] };
    } else {
      imageInlineData = { mimeType: "image/png", data: image };
    }
  }

  const systemPrompt = `You are GuideMe AI Assistant, a Khmer-first expert interactive web walkthrough companion.
Current User Context:
${context?.guideTitle ? `Tutorial: "${context.guideTitle}"` : "General Webpage / App Navigation"}
${context?.currentStep ? `Current Step: ${context.currentStep}` : ""}
${image ? "The user also attached an image or screenshot (such as an error popup, target UI element, or screen capture). Examine visual details carefully and incorporate them directly into your guidance." : ""}

IMPORTANT — Language Understanding:
- Users write in Khmer (ខ្មែរ), English, or a mix of both.
- Khmer speakers often omit action verbs and express intent as a goal phrase, e.g.:
    "ការចែករំលែកឯកសារ" → ACTIONABLE (share a document)
    "ស្វែងរករបស់" → ACTIONABLE (search for something)
    "ចូលគណនី" or "ចូល" alone → ACTIONABLE (sign in)
    "ការកំណត់" → ACTIONABLE (open settings)
- Do NOT treat short Khmer goal phrases as gibberish or chit-chat.
- Only "សួស្ដី", "ជំរាបសួរ", "អរគុណ", and pure identity questions ("អ្នកជានរណា?") are genuinely NOT ACTIONABLE.

Analyze the User Question${image ? " and attached image" : ""}.
Determine if the user is asking to DO, FIND, SHARE, EDIT, or PERFORM something on the page
(e.g. "how do I share doc", "help me get link to share", "click login", "ចូលគណនី", "ស្វែងរក", "ការចែករំលែក")
OR simply greeting / chatting.

If ACTIONABLE (user wants to perform or find something):
1. "triggerGuide": true
2. "intentPrompt": clean command string in English (e.g. "Share this document", "Sign in", "Search")
3. "intent": An object specifying the exact UI element to find:
   {
     "targetQuery": "Share", // The exact button/link/tab text to find on screen
     "action": "click",      // "click" or "input"
     "role": "button",       // "button" | "input" | "link" | "tab"
     "category": "share",    // "share" | "search" | "auth" | "navigation" | "general"
     "expectedInput": null
   }

If NOT ACTIONABLE (greetings like "hi", "hello", "សួស្ដី", or thanking, or "who are you"):
1. "triggerGuide": false
2. "intentPrompt": null
3. "intent": null

Output MUST be ONLY valid JSON matching this schema:
For Actionable Questions:
{
  "answer": "Your friendly conversational answer in ${language === "km" ? "Khmer (ភាសាខ្មែរ)" : "English"}",
  "triggerGuide": true,
  "intentPrompt": "The actionable command string",
  "intent": {
    "targetQuery": "Share",
    "action": "click",
    "role": "button",
    "category": "share",
    "expectedInput": null
  },
  "relatedTips": ["Tip 1", "Tip 2"]
}

For Greetings / Non-Actionable:
{
  "answer": "Your friendly greeting",
  "triggerGuide": false,
  "intentPrompt": null,
  "intent": null,
  "relatedTips": ["Tip 1", "Tip 2"]
}`;

  // 1. Try OpenRouter Universal AI Gateway (Top Priority — zero quota bottleneck)
  const openRouter = getOpenRouterConfig(planTier);
  if (openRouter) {
    try {
      const userContent = image
        ? [
            { type: "text", text: `${systemPrompt}\n\nUser Question: ${question}` },
            {
              type: "image_url",
              image_url: {
                url: image.startsWith("data:") ? image : `data:image/png;base64,${image}`,
              },
            },
          ]
        : `${systemPrompt}\n\nUser Question: ${question}`;

      const response = await fetch(openRouter.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openRouter.apiKey}`,
          "HTTP-Referer": "https://guideme.cadt.edu.kh",
          "X-Title": "GuideMe Interactive Walkthrough",
        },
        body: JSON.stringify({
          model: openRouter.model,
          messages: [
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 1024,
          reasoning: { effort: "minimal" },
        }),
        signal: AbortSignal.timeout(openRouter.timeoutMs),
      });

      if (response.ok) {
        const data: any = await response.json();
        const contentText = data.choices?.[0]?.message?.content;
        if (contentText) {
          const cleaned = cleanJsonResponse(contentText);
          const parsed = JSON.parse(cleaned);
          const validated = ContextualAssistantResponseSchema.safeParse(parsed);
          if (validated.success) {
            const isActionable = validated.data.triggerGuide;
            let finalIntent = validated.data.intent as AssistantIntentInstruction | null;
            if (isActionable && !finalIntent) {
              finalIntent = extractIntentFromPrompt(question, validated.data.intentPrompt);
            }
            return {
              answer: validated.data.answer,
              triggerGuide: isActionable,
              intentPrompt: validated.data.intentPrompt || (isActionable ? question : undefined),
              intent: finalIntent,
              relatedTips: validated.data.relatedTips,
            };
          }
        }
      } else {
        const errText = await response.text().catch(() => "");
        console.warn(`[AI Assistant] OpenRouter returned HTTP ${response.status}:`, errText.slice(0, 150));
      }
    } catch (err: any) {
      console.warn("[AI Assistant] OpenRouter query failed, falling back to Gemini:", err?.message);
    }
  }

  // 2. Fallback: Try Gemini API (Rotating Pool)
  if (geminiKeys.length > 0) {
    // Cap the sequential fallback to 2 keys — enough to cover a single
    // quota-exhausted key without stacking unbounded per-key timeouts.
    for (const geminiApiKey of geminiKeys.slice(0, 2)) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
        const parts: any[] = [
          { text: `${systemPrompt}\n\nUser Question: ${question}` },
        ];

        if (imageInlineData) {
          parts.push({
            inlineData: {
              mimeType: imageInlineData.mimeType,
              data: imageInlineData.data,
            },
          });
        }

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts,
                },
              ],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.2,
                maxOutputTokens: 1024,
              },
            }),
            signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS) || 2500),
          }
        );

        if (response.ok) {
          const data: any = await response.json();
          const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (jsonText) {
            const cleaned = cleanJsonResponse(jsonText);
            const parsed = JSON.parse(cleaned);
            const validated = ContextualAssistantResponseSchema.safeParse(parsed);
            if (validated.success) {
              const isActionable = validated.data.triggerGuide;
              let finalIntent = validated.data.intent as AssistantIntentInstruction | null;
              if (isActionable && !finalIntent) {
                finalIntent = extractIntentFromPrompt(question, validated.data.intentPrompt);
              }
              return {
                answer: validated.data.answer,
                triggerGuide: isActionable,
                intentPrompt: validated.data.intentPrompt || (isActionable ? question : undefined),
                intent: finalIntent,
                relatedTips: validated.data.relatedTips,
              };
            }
          }
        } else {
          const errText = await response.text().catch(() => "");
          console.warn(`[AI Assistant] Gemini key ...${geminiApiKey.slice(-6)} returned HTTP ${response.status}:`, errText.slice(0, 150));
        }
      } catch (err: any) {
        console.warn(`[AI Assistant] Gemini key ...${geminiApiKey.slice(-6)} failed:`, err?.message);
      }
    }
  }


  // 3. Smart Heuristic Fallback (Offline / Failover)
  // ── Greeting detection ──
  const isGreeting =
    /\b(hi|hello|hey|heya|yo|hiya|howdy|sup|greetings|say\s*hi|say\s*hello|good\s*(morning|afternoon|evening|day))\b/i.test(question) ||
    /(សួស្ដី|ជំរាបសួរ|ហេឡូ|ហាយ|អរុណសួស្ដី|រាត្រីសួស្ដី|ជំរាប\s*ប្អូន|ជំរាប\s*លោក)/.test(question);

  // ── Gratitude detection ──
  const isGratitude =
    /\b(thanks?|thank\s+you|thx|cheers)\b/i.test(question) ||
    /(អរគុណ|ច្រើនអរគុណ|សូមអរគុណ|ថ្លែងអំណរ)/.test(question);

  // ── Identity question detection ──
  const isIdentity =
    /\b(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+guideme)\b/i.test(question) ||
    /(អ្នកជានរណា|អ្នកអាចធ្វើអ្វី|guideme\s*ជាអ្វី|អ្វី\s*គឺ\s*guideme)/.test(question);

  // ── Actionable intent detection ──
  // Khmer verbs and nouns expanded to cover natural phrasing without explicit action words.
  const isActionable = Boolean(image) || (
    !isGreeting && !isGratitude && !isIdentity && (
      /\b(share|click|open|find|search|edit|save|login|sign|send|upload|download|export|how\s+to|help\s+me|can\s+you|show\s+me|error|fix|create|delete|add|change|update|submit|buy|pay)\b/i.test(question) ||
      /(ចែករំលែក|ចែករំ|ចូល|ចូលគណនី|ចុះឈ្មោះ|បើក|ចុច|ចុចលើ|ស្វែងរក|ស្វែង|វាយ|វាយបញ្ចូល|កែ|កែប្រែ|រក្សាទុក|ចូលប្រព័ន្ធ|ផ្ញើ|ផ្ទុកឡើង|ទាញយក|ទាញ|ចិញ្ចឹម|ទិញ|ទូទាត់|បង្កើត|លុប|លុបចោល|បន្ថែម|ផ្លាស់ប្ដូរ|ដោះស្រាយ|ផ្ទេរ|ធ្វើ|ត្រូវការ|ចង់|ចង់ធ្វើ|ជួយ|ណែនាំ|ការ(ចូល|ចុះឈ្មោះ|ចែករំលែក|ស្វែងរក|កំណត់|ទាញ|ផ្ញើ|បង្កើត|លុប|ទិញ))/.test(question)
    )
  );
  let fallbackIntent: AssistantIntentInstruction | null = null;
  if (isActionable) {
    const isSearch = /\b(search|find|ស្វែងរក|រក)\b/i.test(question);
    const isShare = /\b(share|invite|ចែករំលែក)\b/i.test(question);
    const isAuth = /\b(login|sign\s*in|register|ចូល)\b/i.test(question);
    const isSettings = /\b(settings|profile|account|ការកំណត់)\b/i.test(question);

    let targetQuery = "Action";
    let category = "general";
    let role: "button" | "input" | "link" = "button";
    let action: "click" | "input" = "click";

    if (isShare) {
      targetQuery = "Share";
      category = "share";
    } else if (isSearch) {
      targetQuery = "Search";
      category = "search";
      role = "input";
      action = "input";
    } else if (isAuth) {
      targetQuery = "Sign In";
      category = "auth";
    } else if (isSettings) {
      targetQuery = "Settings";
      category = "navigation";
    } else {
      const words = question.replace(/[^a-zA-Z0-9\s]/g, "").split(/\s+/).filter((w) => w.length >= 3);
      targetQuery = words[words.length - 1] || "Action";
    }

    fallbackIntent = {
      targetQuery,
      action,
      role,
      category,
    };
  }

  // Generate appropriate answer based on detected category
  let fallbackAnswer = "";
  if (language === "km") {
    if (isGreeting) {
      const nameMatch = question.match(/(?:say\s*hi|say\s*hello|greet)\s*(?:to\s+)?([a-zA-Z0-9_\s]{1,20}?)(?:\s+to\s+me|\s+please)?$/i);
      const targetName = nameMatch ? nameMatch[1].trim() : "";
      fallbackAnswer = targetName
        ? `សួស្តី ${targetName}! ខ្ញុំជា GuideMe AI Assistant។ តើខ្ញុំអាចជួយអ្វីអ្នកនៅលើទំព័រនេះ?`
        : `សួស្ដី! ខ្ញុំជា GuideMe AI Assistant។ តើខ្ញុំអាចជួយណែនាំអ្វីខ្លះដល់អ្នកនៅលើទំព័រនេះ?`;
    } else if (isGratitude) {
      fallbackAnswer = `រីករាយណាស់ដែលបានជួយ! ប្រសិនបើអ្នកត្រូវការជំនួយផ្សេងទៀត សូមប្រាប់ខ្ញុំបានគ្រប់ពេល។`;
    } else if (isIdentity) {
      fallbackAnswer = `ខ្ញុំជាជំនួយការ GuideMe AI។ ខ្ញុំអាចជួយណែនាំអ្នកមួយជំហានម្តងៗដោយបង្ហាញប៊ូតុង និងកន្លែងដែលត្រូវបំពេញនៅលើអេក្រង់ដោយផ្ទាល់!`;
    } else if (image) {
      fallbackAnswer = `ខ្ញុំបានពិនិត្យមើលរូបភាព/អេក្រង់ដែលអ្នកបានភ្ជាប់រួចហើយ! ផ្អែកលើសំណួរ "${question}"៖ ខ្ញុំកំពុងបង្ហាញនិងបញ្ជាក់លើប៊ូតុងដែលពាក់ព័ន្ធនៅលើអេក្រង់របស់អ្នក។`;
    } else if (isActionable) {
      fallbackAnswer = `ខ្ញុំយល់ហើយ! ខ្ញុំកំពុងបង្ហាញនិងបញ្ជាក់លើប៊ូតុងនៅលើអេក្រង់របស់អ្នកដើម្បីជួយអ្នក "${question}"។`;
    } else {
      fallbackAnswer = `នេះជាព័ត៌មានទាក់ទងនឹង "${question}"។ ប្រសិនបើអ្នកចង់ឱ្យខ្ញុំបង្ហាញប៊ូតុង ឬការកំណត់ជាក់លាក់នៅលើអេក្រង់នេះ សូមប្រាប់ខ្ញុំបាន!`;
    }

    return {
      answer: fallbackAnswer,
      triggerGuide: isActionable,
      intentPrompt: isActionable ? question : undefined,
      intent: fallbackIntent,
      relatedTips: isGreeting
        ? [
            "សួររបៀបប្រើប្រាស់មុខងារនានា",
            "ស្នើសុំឱ្យបង្ហាញផ្លូវ ឬស្វែងរកប៊ូតុងនៅលើទំព័រ",
          ]
        : [
            "ពិនិត្យសារកំហុសនៅលើរូបភាព ឬអេក្រង់",
            "ចុចប៊ូតុងសំឡេងដើម្បីស្តាប់ការណែនាំជាភាសាខ្មែរ",
          ],
    };
  }

  // English fallback
  if (isGreeting) {
    const nameMatch = question.match(/(?:say\s*hi|say\s*hello|greet)\s*(?:to\s+)?([a-zA-Z0-9_\s]{1,20}?)(?:\s+to\s+me|\s+please)?$/i);
    const targetName = nameMatch ? nameMatch[1].trim() : "";
    fallbackAnswer = targetName
      ? `Hello! Hi ${targetName}! I am your GuideMe AI Assistant. How can I help you on this page today?`
      : `Hello! I am your GuideMe AI Assistant. How can I help you navigate or use this page today?`;
  } else if (isGratitude) {
    fallbackAnswer = `You're very welcome! Let me know if you need help navigating or using anything else on this screen.`;
  } else if (isIdentity) {
    fallbackAnswer = `I am your GuideMe AI Assistant. I guide you step-by-step through websites and web applications by highlighting buttons, inputs, and actions directly on your screen!`;
  } else if (image) {
    fallbackAnswer = `I analyzed your attached image/screenshot! Based on "${question}": I am spotlighting the relevant action on your screen to help resolve it.`;
  } else if (isActionable) {
    fallbackAnswer = `Got it! I am spotlighting the relevant action on your screen to guide you step-by-step for "${question}".`;
  } else {
    fallbackAnswer = `Here is guidance regarding "${question}": If you would like me to spotlight a specific button or setting on this page, please ask!`;
  }

  return {
    answer: fallbackAnswer,
    triggerGuide: isActionable,
    intentPrompt: isActionable ? question : undefined,
    intent: fallbackIntent,
    relatedTips: isGreeting
      ? [
          "Ask me how to use specific features on this page",
          "Ask me to find buttons, settings, or search bars",
        ]
      : [
          "Check error details in the screenshot or screen",
          "Click the voice icon to hear audio instructions",
        ],
  };
}

function generateFallbackGuide(prompt: string, category: string, language: string): AIGuideResponse {
  if (language === "km") {
    return {
      title: `ការណែនាំ៖ ${prompt}`,
      description: `ការណែនាំជាជំហានៗសម្រាប់ "${prompt}" ដែលបង្កើតឡើងដោយស្វ័យប្រវត្តិ។`,
      category,
      steps: [
        {
          stepNumber: 1,
          title: "បើកផ្ទាំងកម្មវិធី",
          instruction: "បើកកម្មវិធីដែលអ្នកចង់ប្រើ ហើយចូលទៅកាន់ផ្ទាំងដើម (Home screen)។",
          hint: "ត្រូវប្រាកដថាអ្នកបានភ្ជាប់អ៊ីនធឺណិតរួចរាល់។",
          targetElement: "nav-home",
        },
        {
          stepNumber: 2,
          title: "ស្វែងរកប៊ូតុងមុខងារ",
          instruction: `ស្វែងរកមុខងារទាក់ទងនឹង "${prompt}" នៅលើម៉ឺនុយ ឬរបារស្វែងរក។`,
          hint: "សម្លឹងមើលរូបតំណាង (Icons) ដែលមានស្លាកឈ្មោះច្បាស់លាស់។",
          targetElement: "search-input",
        },
        {
          stepNumber: 3,
          title: "បំពេញព័ត៌មានដែលត្រូវការ",
          instruction: "វាយបញ្ចូលព័ត៌មានតាមការណែនាំនៅលើអេក្រង់ ហើយពិនិត្យឡើងវិញដោយប្រុងប្រយ័ត្ន។",
          hint: "កុំចែករំលែកលេខសម្ងាត់ (PIN/Password) ទៅកាន់អ្នកដទៃ។",
          targetElement: "form-input",
        },
        {
          stepNumber: 4,
          title: "ចុចបញ្ជាក់ដើម្បីបញ្ចប់",
          instruction: "ចុចប៊ូតុង 'យល់ព្រម' ឬ 'បន្ត' ដើម្បីបញ្ចប់ប្រតិបត្តិការដោយជោគជ័យ។",
          hint: "អ្នកអាចថតអេក្រង់ទុកជាភស្តុតាង។",
          targetElement: "btn-confirm",
        },
      ],
    };
  }

  return {
    title: `Guide: ${prompt}`,
    description: `Step-by-step interactive walkthrough for "${prompt}".`,
    category,
    steps: [
      {
        stepNumber: 1,
        title: "Open the Application",
        instruction: "Navigate to the main screen of the application you want to use.",
        hint: "Ensure your internet connection is active.",
        targetElement: "nav-home",
      },
      {
        stepNumber: 2,
        title: "Locate the Feature",
        instruction: `Find the feature related to "${prompt}" in the menu or search bar.`,
        hint: "Look for the highlighted button on the screen.",
        targetElement: "search-input",
      },
      {
        stepNumber: 3,
        title: "Enter Required Details",
        instruction: "Fill in the required inputs as instructed and double check for accuracy.",
        hint: "Never share private PINs or passwords with anyone.",
        targetElement: "form-input",
      },
      {
        stepNumber: 4,
        title: "Confirm & Complete",
        instruction: "Click 'Confirm' or 'Submit' to finish the process.",
        hint: "You will receive a confirmation message once completed.",
        targetElement: "btn-confirm",
      },
    ],
  };
}

export interface CandidateDescriptor {
  id: string;
  category: string;
  label: string;
  text?: string;
}

/**
 * Re-ranks Stage 1 candidates via Gemini LLM on the backend.
 * Keeps all API keys, prompts, and server secrets securely on the server side.
 */
export interface DomCandidate {
  index?: number;
  tag: string;
  type?: string;
  id?: string;
  name?: string;
  testId?: string;
  ariaLabel?: string;
  placeholder?: string;
  role?: string;
  text?: string;
  selector: string;
}



/**
 * Generates an interactive GuideMe walkthrough schema from live webpage DOM elements
 * using OpenRouter (Universal AI Gateway) or Google Gemini.
 */
export async function generateDomGuideSteps(params: {
  prompt: string;
  elements: DomCandidate[];
  url?: string;
  language?: string;
  planTier?: string;
}): Promise<any> {
  const { prompt, elements, url = "", language = "km", planTier } = params;

  if (!Array.isArray(elements) || elements.length === 0) {
    throw new Error("No interactive DOM elements provided for AI analysis.");
  }

  const geminiKeys = getOrderedGeminiApiKeys();

  const systemInstruction = `You are GuideMe AI, an expert interactive web walkthrough and DOM guidance engine.
Your mission is to inspect the provided interactive DOM elements from a webpage and the user's intent, and generate a step-by-step interactive tutorial flow adhering strictly to GuideMe's JSON schema.

Requirements:
1. Element Selection & Universal Multi-Step Planning:
   - For currently visible elements, select their selectors and labels from the provided interactive DOM elements list.
   - For nested submenu items, settings, or workflow actions that only render after opening a menu or modal (e.g. "Page setup" inside "File", "Billing" in "Settings", "Download" in an "Actions" menu):
     Generate the step using universal semantic targets:
     "target": {
       "css": "[role=\"menuitem\"], button, a, [role=\"button\"], span",
       "text": "<Exact name of submenu item or button>",
       "ariaLabel": "<Exact name of submenu item or button>"
     }
     Our Just-in-Time (JIT) runtime engine uses MutationObserver to attach to the target the millisecond the parent menu is opened.
2. Universal Multi-Step Menu Rule:
   - If reaching the goal requires navigating through a menu, dropdown, sidebar, or dialog (e.g. File → Page Setup, Settings → General, Actions → Export):
     You MUST generate a separate, sequential step for EACH level:
     - Step 1: Open the parent menu/container (e.g. Click "File").
     - Step 2: Click the nested submenu item (e.g. Click "Page setup").
     - Step 3+: Configure options in the modal or dialog if requested (e.g. Select "A4").
   - NEVER skip the parent menu and jump straight to a hidden submenu item.
   - NEVER target irrelevant navigation logos (like "Docs home") when the user asked for an in-app action.
3. For each step:
   - "id": unique string identifier (e.g. "step_1", "step_2")
   - "title": Bilingual object { "km": "...", "en": "..." } (REQUIRED at step root)
   - "description": Bilingual object { "km": "...", "en": "..." }
   - "target": {
       "css": exact CSS selector from candidate list or universal fallback,
       "text": element text if present,
       "ariaLabel": ariaLabel if present,
       "testId": testId if present,
       "container": "[role=\"dialog\"], .modal-dialog" (when targeting controls inside an open modal)
     }
   - "action": {
       "type": "spotlight",
       "title": { "km": "...", "en": "..." },
       "content": { "km": "...", "en": "..." },
       "placement": "bottom" | "top" | "left" | "right"
     }
   - "validation": {
       "type": "click" | "input" | "change" | "submit" | "manual_next"
     }
4. GuideMe is Khmer-First: "km" (Khmer) must be natural, accurate, and beginner-friendly. "en" (English) is secondary.
5. Output MUST be ONLY pure valid JSON (no surrounding markdown text, no conversational filler) matching:
{
  "id": "guide-${Date.now()}",
  "version": "1.0.0",
  "name": { "km": "...", "en": "..." },
  "description": { "km": "...", "en": "..." },
  "matchUrls": ["<all_urls>"],
  "steps": [ ... ]
}`;

  const elementsPreview = elements.slice(0, 80);
  const userContent = `Page URL: ${url || "webpage"}
User Request / Goal: "${prompt}"

Interactive DOM Elements on page:
${JSON.stringify(elements.slice(0, 400), null, 2)}

Generate the interactive tutorial JSON now.`;

  // The same intent against the same DOM snapshot must always return the same
  // guide. A cache hit is a stronger determinism guarantee than temperature 0
  // alone, and skips the LLM call entirely on repeat requests.
  const cacheKey = REDIS_KEY.guideSteps(
    guideStepsCacheKey({ fn: "generateDomGuideSteps", prompt, url, language, elements: elementsPreview })
  );
  const cached = await redis.getJson<any>(cacheKey);
  if (cached) return cached;

  const result = await (async (): Promise<any> => {
    // Run OpenRouter and every Gemini key concurrently instead of one after
    // another — see the identical comment in generateSteps() for why a
    // sequential chain made a bad run (every provider slow/down) feel like
    // it hung for up to ~50s before reaching the instant heuristic fallback.
    const attempts: Promise<any>[] = [];

    const openRouter = getOpenRouterConfig(planTier);
    if (openRouter) {
      attempts.push(
        (async () => {
          try {
            const response = await fetch(openRouter.endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${openRouter.apiKey}`,
                "HTTP-Referer": "https://guideme.cadt.edu.kh",
                "X-Title": "GuideMe Interactive Walkthrough",
              },
              body: JSON.stringify({
                model: openRouter.model,
                messages: [
                  { role: "system", content: systemInstruction },
                  { role: "user", content: userContent },
                ],
                response_format: { type: "json_object" },
                // Deterministic: the same intent + candidate list must always
                // resolve to the same target element, not a different one each run.
                temperature: 0,
                max_tokens: 4096,
                reasoning: { effort: "minimal" },
              }),
              signal: AbortSignal.timeout(GUIDE_GENERATION_TIMEOUT_MS),
            });

            if (response.ok) {
              const data: any = await response.json();
              const contentText = data.choices?.[0]?.message?.content;
              if (contentText) {
                const cleaned = cleanJsonResponse(contentText);
                const parsed = JSON.parse(cleaned);
                if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
                  return hardenAndValidateTutorial(parsed, elements, prompt);
                }
              }
            } else {
              const errText = await response.text().catch(() => "");
              console.warn(`[AI Service] OpenRouter DOM generation returned HTTP ${response.status}:`, errText.slice(0, 150));
            }
            return null;
          } catch (err: any) {
            console.warn("[AI Service] OpenRouter DOM generation error:", err?.message);
            return null;
          }
        })()
      );
    }

    // Cap to 2 keys — enough to cover a single quota-exhausted key without
    // stacking unbounded attempts. Both run in parallel with OpenRouter above.
    for (const geminiApiKey of geminiKeys.slice(0, 2)) {
      attempts.push(
        (async () => {
          try {
            const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [
                  {
                    parts: [{ text: `${systemInstruction}\n\n${userContent}` }],
                  },
                ],
                generationConfig: {
                  responseMimeType: "application/json",
                  // Deterministic — see the OpenRouter call above for why.
                  temperature: 0,
                  maxOutputTokens: 4096,
                },
              }),
              signal: AbortSignal.timeout(GUIDE_GENERATION_TIMEOUT_MS),
            });

            if (response.ok) {
              const data: any = await response.json();
              const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (jsonText) {
                const cleaned = cleanJsonResponse(jsonText);
                const parsed = JSON.parse(cleaned);
                if (parsed && Array.isArray(parsed.steps) && parsed.steps.length > 0) {
                  return hardenAndValidateTutorial(parsed, elements, prompt);
                }
              }
            }
            return null;
          } catch (err: any) {
            console.warn(`[AI Service] Gemini key ...${geminiApiKey.slice(-6)} DOM generation error:`, err?.message);
            return null;
          }
        })()
      );
    }

    const raced = await firstNonNull(attempts);
    if (raced) return raced;

    // No silent substitute: every AI provider failed or timed out. Throw
    // instead of quietly returning a heuristic-only template tutorial as if
    // it were a real result — the caller should see this as an error.
    throw Object.assign(
      new Error("AI guide generation failed: no provider returned a usable result."),
      { statusCode: 502, code: "AI_GUIDE_GENERATION_FAILED" }
    );
  })();

  if (result) await redis.setJson(cacheKey, result, REDIS_TTL.GUIDE_STEPS);
  return result;
}

export async function rerankIntentCandidates(
  prompt: string,
  candidates: CandidateDescriptor[],
  planTier?: string
): Promise<{ stepIds: string[] }> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { stepIds: [] };
  }

  const geminiKeys = getOrderedGeminiApiKeys();

  const systemPrompt =
    'You are an interactive tutorial engine. Given a user goal and UI candidates, return the 1 to 3 candidate IDs in order of interaction needed to fulfill the goal. Return ONLY valid JSON matching: {"stepIds": ["cand-0", ...]}';
  const userMessage = JSON.stringify({ userGoal: prompt, candidates });

  // 0. Try OpenRouter Universal AI Gateway (Top Priority)
  const openRouter = getOpenRouterConfig(planTier);
  if (openRouter) {
    try {
      const response = await fetch(openRouter.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${openRouter.apiKey}`,
          "HTTP-Referer": "https://guideme.cadt.edu.kh",
          "X-Title": "GuideMe Interactive Walkthrough",
        },
        body: JSON.stringify({
          model: openRouter.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 512,
          reasoning: { effort: "minimal" },
        }),
        signal: AbortSignal.timeout(openRouter.timeoutMs),
      });

      if (response.ok) {
        const data: any = await response.json();
        const contentText = data.choices?.[0]?.message?.content;
        if (contentText) {
          const cleaned = cleanJsonResponse(contentText);
          const parsed = JSON.parse(cleaned);
          const validated = IntentRerankResponseSchema.safeParse(parsed);
          if (validated.success && Array.isArray(validated.data.stepIds)) {
            const validIds = new Set(candidates.map((c) => c.id));
            const filtered = validated.data.stepIds.filter((id: string) => validIds.has(id));
            if (filtered.length > 0) {
              return { stepIds: filtered };
            }
          }
        }
      }
    } catch (err: any) {
      console.warn("[AI Service] OpenRouter rerank error, falling back to Gemini:", err?.message);
    }
  }

  // 1. Try Gemini API first
  if (geminiKeys.length > 0) {
    // Cap the sequential fallback to 2 keys — enough to cover a single
    // quota-exhausted key without stacking unbounded per-key timeouts.
    for (const geminiApiKey of geminiKeys.slice(0, 2)) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: `${systemPrompt}\n\nContext:\n${userMessage}` },
                  ],
                },
              ],
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
                maxOutputTokens: 512,
              },
            }),
            signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS) || 2500),
          }
        );

        if (response.ok) {
          const data: any = await response.json();
          const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (jsonText) {
            const cleaned = cleanJsonResponse(jsonText);
            const parsed = JSON.parse(cleaned);
            const validated = IntentRerankResponseSchema.safeParse(parsed);
            if (validated.success && Array.isArray(validated.data.stepIds)) {
              const validIds = new Set(candidates.map((c) => c.id));
              const filtered = validated.data.stepIds.filter((id: string) => validIds.has(id));
              if (filtered.length > 0) {
                return { stepIds: filtered };
              }
            }
          }
        }
      } catch (err: any) {
        console.warn(`[AI Service] Gemini key ...${geminiApiKey.slice(-6)} rerank error:`, err?.message);
      }
    }
  }



  // Fallback: Return top candidates up to 3
  return {
    stepIds: candidates.slice(0, 3).map((c) => c.id),
  };
}


export interface ValidatedIntent {
  valid: boolean;
  reason?: string;
  pages?: {
    route: "current" | string;
    action: string;
    target?: string;
    description: string;
  }[];
  /**
   * "quick-pass" when a regex short-circuit answered without calling an LLM
   * (greeting/vague-filler tiers). Lets callers skip a redundant follow-up
   * LLM call (e.g. assistant-chat) when this `reason` is already a complete,
   * ready-to-show reply. Omitted for LLM-decided and heuristic-valid results.
   */
  source?: "quick-pass" | "llm";
}

/**
 * Stage 1: Validates user intent via LLM and optionally plans multi-page steps.
 * Uses OpenRouter first, Gemini fallback. If both fail, asks the user to clarify.
 */
export async function validateIntent(
  prompt: string,
  currentUrl: string = "",
  language: string = "km",
  planTier?: string
): Promise<ValidatedIntent> {
  const openrouterKey = (process.env.OPENROUTER_API_KEY || process.env.WXT_AI_API_KEY || "").trim();
  const geminiKeys = getOrderedGeminiApiKeys();
  const trimmed = prompt.trim().toLowerCase();

  // ── Quick-pass tier 1: greetings → instant invalid ──
  // Covers standalone greetings in English and common Khmer equivalents.
  const greetings = /^(hi|hello|hey|yo|sup|howdy|hiya|good\s*(morning|afternoon|evening)|សួស្ដី|ជំរាបសួរ|ហេឡូ|ហាយ|អរុណសួស្ដី|រាត្រីសួស្ដី)[\s!.,។?]*$/i;
  if (greetings.test(trimmed)) {
    const reply = language === "km"
      ? "សួស្ដី! តើអ្នកចង់ឱ្យខ្ញុំជួយអ្វីលើទំព័រនេះ?"
      : "Hi! What would you like help with on this page?";
    return { valid: false, reason: reply, pages: [], source: "quick-pass" };
  }

  // ── Quick-pass tier 2: vague/unclear inputs → instant invalid ──
  // Includes common Khmer filler words that express no clear action.
  const unclear = /^(help|help me|do something|please|ok|okay|yes|no|thanks|thank you|idk|hmm|huh|what|why|how|show me|tell me|guide me|ជួយ|សូម|អរគុណ|អ្វី|ហេតុអ្វី|ថ្ងៃនេះ|អត់ចេះ|មិនដឹង|ខ្ញុំ|អ្នក|លោក|គាត់)[\s!.,។?]*$/i;
  if (unclear.test(trimmed)) {
    const reply = language === "km"
      ? "សូមបញ្ជាក់អ្វីដែលអ្នកចង់ធ្វើ ឧទាហរណ៍៖ \"ចុចប៊ូតុង Login\" ឬ \"ចែករំលែកឯកសារ\""
      : "Please specify what you want to do. Example: \"Click the Login button\" or \"Share this document\"";
    return { valid: false, reason: reply, pages: [], source: "quick-pass" };
  }

  // ── Quick-pass tier 3: explicit action verbs → instant valid (~85% of real prompts) ──
  // Khmer verbs expanded: covers common synonyms and natural phrasing users type.
  const actionVerbs = /\b(click|press|tap|open|go\s*to|navigate|search|find|type|enter|fill|submit|save|buy|add|remove|delete|edit|create|sign\s*in|log\s*in|sign\s*up|register|checkout|download|upload|share|invite|send|select|choose|export|import|print|scroll|help\s*me\s*(share|click|open|find|search|login|edit)|how\s*to|i\s*want\s*to|i\s*need\s*to)\b|(ចុច|ចុចលើ|ចុចប៊ូតុង|បើក|ទៅ|ទៅកាន់|ស្វែងរក|រក|វាយ|វាយបញ្ចូល|បញ្ចូល|រក្សាទុក|ទិញ|បន្ថែម|លុប|លុបចោល|កែ|កែប្រែ|បង្កើត|ចូល|ចូលគណនី|ចុះឈ្មោះ|ទាញយក|ផ្ញើ|ជ្រើសរើស|មើល|ចែករំលែក|ចែករំ|កំណត់|បិទ|ស្ដារ|ផ្លាស់ប្ដូរ|ផ្ទុកឡើង|ធ្វើ|ចង់|ចង់ធ្វើ|ត្រូវការ|ជួយខ្ញុំ|ប្រើ|ប្រើប្រាស់|ចង់ប្រើ|ចង់ដឹង|ណែនាំ|ដោះស្រាយ|ផ្ទេរ|ចូលប្រព័ន្ធ|ចេញ|ចូលទៅ|ចូលមើល|ព្យាយាម|ជួយបើក|ជួយចុច|ជួយផ្ញើ|ជួយបង្កើត|ជួយកែ|ជួយចូល|ជួយទិញ|ជួយទាញ|ជួយចែករំលែក|ជួយស្វែងរក|ជួយ)/i;
  if (actionVerbs.test(prompt)) {
    return { valid: true, reason: "", pages: [{ route: "current", action: "user_intent", target: "", description: prompt }] };
  }

  // ── Quick-pass tier 4: English UI noun targets → instant valid ──
  const uiNounTargets = /\b(button|btn|link|menu|tab|modal|dialog|dropdown|select|input|field|form|checkbox|radio|toggle|slider|icon|photo|avatar|logo|banner|sidebar|navbar|header|footer|card|list|table|panel|popup|tooltip|badge|chip|label|heading|paragraph|screen|section|container|toolbar|breadcrumb|pagination|spinner|loader|alert|notification|toast|snackbar|drawer|overlay|backdrop|profile|account|dashboard|feed|inbox|chat|password|username|address|payment|cart|order|product|document|folder|video|audio|attachment)\b/i;
  if (uiNounTargets.test(trimmed)) {
    return { valid: true, reason: "", pages: [{ route: "current", action: "user_intent", target: "", description: prompt }] };
  }

  // ── Quick-pass tier 5: Khmer UI noun targets and goal-oriented phrasing → instant valid ──
  // Matches natural Khmer phrases that describe a goal even without an explicit action verb.
  const khmerUiNouns = /(ប៊ូតុង|តំណ|ម៉ឺនុយ|ផ្ទាំង|ទម្រង់|ប្រអប់|ជ្រើស|ផ្ទៃ|គណនី|លេខសម្ងាត់|ពាក្យសម្ងាត់|ឯកសារ|រូបថត|វីដេអូ|ការទូទាត់|ការទិញ|ការចុះឈ្មោះ|ការចូល|ការចែករំលែក|ការផ្ញើ|ការស្វែងរក|ការកំណត់|ការបិទ|ការបើក|ការលុប|ការបន្ថែម|ការកែ|ការទាញ|ការផ្ទុក|ប្រព័ន្ធ|ទំព័រ|ទំព័រដើម|សារ|ការជូនដំណឹង|ការផ្ទេរ|ថត|តារាង|បញ្ជី)/i;
  if (khmerUiNouns.test(trimmed)) {
    return { valid: true, reason: "", pages: [{ route: "current", action: "user_intent", target: "", description: prompt }] };
  }

  const lang = language === "km" ? "Khmer" : "English";
  const systemPrompt = `You validate user intents for GuideMe, a browser tutorial assistant. Respond as JSON.

Rules:
- Users may type in Khmer, English, or a mix of both, possibly with typos or informal phrasing. Be very tolerant.
- Khmer speakers often omit explicit action verbs and describe goals directly (e.g. "ការចែករំលែកឯកសារ" = "document sharing"). Treat these as valid actionable intents.
- If the request is about doing something on a webpage → valid: true, plan pages needed (usually one page with route "current").
- If it is clearly a greeting, chit-chat, or completely unintelligible gibberish → valid: false, reason in ${lang} suggesting what to ask.

Schema:
{"valid":boolean,"reason":"string in ${lang}","pages":[{"route":"current","action":"string","target":"","description":"string"}]}`;
  const userMessage = JSON.stringify({ prompt, currentUrl, language });

  // Try OpenRouter first
  if (openrouterKey) {
    const openRouter = getOpenRouterConfig(planTier);
    if (openRouter) {
      try {
        const controller = new AbortController();
        // 7-second timeout — leaves 1 second buffer before extension's 8-second client timeout.
        const timeoutId = setTimeout(() => controller.abort(), 7000);
        const response = await fetch(openRouter.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${openRouter.apiKey}`,
            "HTTP-Referer": "https://guideme.cadt.edu.kh",
            "X-Title": "GuideMe Interactive Walkthrough",
          },
          body: JSON.stringify({
            model: openRouter.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
            // 512 was too tight for a Khmer "reason" string — Khmer script
            // tokenizes to more tokens per character than Latin text, so
            // longer replies were getting cut off mid-string, producing a
            // genuinely truncated (not just malformed) JSON body that no
            // amount of sanitization can repair.
            max_tokens: 1024,
            // Root cause of the truncation was actually the model's mandatory
            // reasoning tokens eating the budget before any real content came
            // out (confirmed via usage.completion_tokens_details.reasoning_tokens
            // consuming ~250/256 tokens on a trivial prompt) — "minimal" effort
            // keeps that from happening and also cuts multi-second latency.
            reasoning: { effort: "minimal" },
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data: any = await response.json();
          const jsonText = data.choices?.[0]?.message?.content;
          if (jsonText) {
            const parsed = JSON.parse(cleanJsonResponse(jsonText));
            if (typeof parsed.valid === "boolean") return parsed;
          }
        }
      } catch (err: any) {
        console.warn("[AI Service] OpenRouter validate-intent failed:", err?.message);
      }
    }
  }

  // Fallback: Gemini rotating pool
  if (geminiKeys.length > 0) {
    // Cap the sequential fallback to 2 keys — enough to cover a single
    // quota-exhausted key without stacking unbounded per-key timeouts.
    for (const geminiApiKey of geminiKeys.slice(0, 2)) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }],
              // See the OpenRouter call above — 512 risked truncating a Khmer reason mid-string.
              generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 1024 },
            }),
            signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS) || 7000),
          }
        );

        if (response.ok) {
          const data: any = await response.json();
          const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (jsonText) {
            const parsed = JSON.parse(cleanJsonResponse(jsonText));
            if (typeof parsed.valid === "boolean") return parsed;
          }
        }
      } catch (err: any) {
        console.warn(`[AI Service] Gemini key ...${geminiApiKey.slice(-6)} validate-intent failed:`, err?.message);
      }
    }
  }

  // No LLM available — ask user to be more specific
  const retryMsg = language === "km"
    ? "សូមអភ័យទោស ខ្ញុំមិនអាចផ្ទៀងផ្ទាត់សំណើរបស់អ្នកបានទេ។ សូមព្យាយាមម្តងទៀត"
    : "Sorry, I couldn't validate your request. Please try again.";
  return { valid: false, reason: retryMsg, pages: [] };
}

/**
 * Stage 2: Generates structured step-by-step tutorial from a prompt + DOM elements.
 * Uses LLM (OpenRouter → Gemini) to reason about which elements to target and in what order.
 */
export async function generateSteps(
  prompt: string,
  elements: DomElementSummary[],
  language: string = "km",
  currentUrl: string = "",
  options: {
    mode?: "initial" | "next_action";
    completedActions?: string[];
    // Structured intent already resolved one step earlier (by
    // /api/ai/assistant-chat's targetQuery/action/role/category contract).
    // Previously this was computed then silently discarded before reaching
    // guide generation, forcing a redundant re-derivation from raw prompt
    // text alone (GM-017). Passed through here as an optional grounding
    // hint only — the model still must verify against the real `elements`
    // list, never trust this blindly (see systemPrompt note below).
    intent?: { targetQuery?: string; action?: string; role?: string; category?: string } | null;
    // FREE-plan requests use a cheaper OpenRouter model by default — see
    // getOpenRouterConfig(). This is by far the highest token-volume call in
    // the service (full DOM element list + long system prompt), so it's the
    // single biggest lever for per-plan cost control.
    planTier?: string;
  } = {}
): Promise<GenerateStepsResponse | null> {
  const geminiKeys = getOrderedGeminiApiKeys();

  const domPreview = elements.slice(0, 400).map((el) => ({
    tag: el.tag,
    id: el.id || undefined,
    text: (el.text || "").slice(0, 40),
    type: el.type || undefined,
    role: el.role || undefined,
    ariaLabel: el.ariaLabel || undefined,
    placeholder: el.placeholder || undefined,
    selector: el.selector || undefined,
    isVisible: el.isVisible !== false,
  }));

  const isContinuation = options.mode === "next_action";
  const completedActions = Array.isArray(options.completedActions) ? options.completedActions : [];

  const systemPrompt = `You are an expert step-by-step tutorial generator for GuideMe, a browser assistant.
Your job: ${isContinuation
    ? "inspect the CURRENT DOM state and produce exactly the next action needed to continue the user's goal. Do not plan hidden future actions."
    : "take the user's goal and produce the COMPLETE list of steps needed to accomplish that goal from start to finish. Never collapse a workflow into one step."}

CRITICAL DECOMPOSITION RULES:
- Break the user's goal into EVERY micro-action a person must perform. Output ONE step per micro-action.
- Example — "create a new file": step 1: click/hover "File" menu, step 2: click "New", step 3: click "Blank document", step 4: (if a name field appears) type the file name, step 5: click "Create"/"OK". That is 4-5 steps.
- Example — "log in": step 1: click "Sign in", step 2: enter email, step 3: click "Next", step 4: enter password, step 5: click submit. That is 5 steps.
- A goal is only complete when its final action is performed, so include EVERY intermediate step.
- EXCEPTION — do not emit a separate "click/select this field" step immediately before a step that types into that exact same field. Clicking into an input/textbox to focus it is implied by typing into it, so a "select the input" step followed immediately by an "type into the input" step on the identical element is a redundant no-op step, not a real micro-action — merge them into ONE step with validation type "input" (e.g. "type your formula, such as =SUM(...), in the formula bar", not "click the formula bar" then "type the formula"). This exception does NOT apply to fields that need a click purely to open/reveal something (a dropdown, a menu, a dialog) before a different element becomes typeable — only to the case where the click target and the typing target are the exact same element.
- CRITICAL: you are NOT given the actual cell values, rows, or columns of any spreadsheet/table — only its UI chrome (buttons, the formula bar, toolbar) is in the provided element list, because grid cells are rendered to a canvas with no DOM presence. NEVER invent a specific cell reference or range (e.g. "D2:D10", "B2:B10") in an instruction as if it were the user's real data — you cannot know that, and a fabricated range is actively wrong guidance if the user's data lives elsewhere. For any step that involves a formula or a data range, phrase the instruction generically and tell the user to select their own actual cells (e.g. "type =SUM( then click and drag across the cells you want to total, then type ) and press Enter" — never a concrete letter-number range).
- CRITICAL: any step whose action is selecting/highlighting a RANGE of cells (e.g. "select these cells and drag to autofill", "highlight the numbers you entered") is not something you can auto-verify — there is no per-cell DOM element to bind a click/input listener to. Target the grid container element instead (an element with role "grid" in the provided list, e.g. selector \`[role="grid"]\`), with validation type "manual_next" so the user confirms manually. Do NOT target a specific cell, and do NOT reuse the formula bar / cell-input selector for this — that selector belongs only to steps where the user types into the active cell, never to a step about selecting a range.

When choosing targets:
- Prefer the exact CSS selector from the provided element list when a matching element exists.
- If an intermediate action has no element in the provided list (e.g. a sub-menu that only appears after hovering), STILL emit the step with a best-effort CSS selector or the visible label text.
- Generate clear instructions in ${language === "km" ? "Khmer" : "English"}.
- For input fields, validation type = "input". For buttons/links, "click". For dropdowns, "change".
- If the requested action absolutely cannot be found on the screen, return a single step with action type "modal", title "Action Not Found", and a description explicitly stating that you cannot locate the requested element (do NOT hallucinate a target).
- CRITICAL: a page can have a heading, label, or section title that shows the exact same text as the button/link/input you actually want (e.g. a "Change Password" section title sitting above a "Change Password" button). For any step whose validation type is "click", "input", or "change", the target MUST be the real interactive element (button/a/input/select/[role="button"]) — never a heading, label, or plain text element, even if its text is a perfect match. Check the provided element list's "tag"/"type"/"role" fields to confirm the element you're targeting is actually interactive before emitting its selector.
- CRITICAL: never target a global/universal search box (e.g. an element labeled "Menus", "Search the menus", "Command palette", "Search everywhere") for a content-editing action like typing a formula, a document field, or any in-place value — even if that search box can theoretically produce the same result via a command shortcut. Use the actual in-place editing element for the task (e.g. the formula bar / cell input, not the app-wide menu search), matching what a normal user would click first. If no such element exists in the provided list, say so via a best-effort selector rather than substituting the nearest unrelated searchable element.
- Two different steps must never resolve to the exact same target selector, with exactly one exception: a click-to-focus step immediately followed by a type-into-it step on that same element — and per the rule above, that exact pair must be merged into one "input" step anyway, so it should never appear in your output either. Outside that case, a repeated selector across steps means the selector is wrong (too generic, or matches an unrelated element) — look for a more specific one, or the actual intended element is missing from the list.
- If the input includes "knownIntent", treat it as a hint from an earlier classification pass, not a verified fact — it can be wrong or stale. Use it to break ties between equally plausible targets, but still ground your final selector in the actual "elements" list like every other step; never target something absent from that list just because knownIntent mentions it.

Return ONLY valid JSON matching this schema:
{
  "tutorial": {
    "id": "llm-guide-{timestamp}",
    "version": "1.0.0",
    "name": "Short title in ${language === "km" ? "Khmer" : "English"}",
    "description": "Brief summary in ${language === "km" ? "Khmer" : "English"}",
    "steps": [
      {
        "id": "step-1",
        "title": "Step 1 title",
        "description": "Step 1 description",
        "target": { "css": "button#submit-btn", "text": "Submit" },
        "action": { "type": "spotlight", "title": "Click Submit", "content": "Click the Submit button", "placement": "bottom" },
        "validation": { "type": "click" }
      }
    ]
  }
}

${isContinuation
    ? 'For continuation mode, return exactly one step in "tutorial.steps". If the goal is already complete, return {"done":true,"tutorial":{"steps":[]}}.'
    : "Generate as many steps as the workflow genuinely needs."}`;

  const userMessage = JSON.stringify({
    goal: prompt,
    pageUrl: currentUrl,
    language,
    mode: options.mode || "initial",
    completedActions,
    elements: domPreview,
    ...(options.intent && (options.intent.targetQuery || options.intent.action)
      ? { knownIntent: options.intent }
      : {}),
  });

  // The same intent against the same DOM snapshot must always return the same
  // guide. A cache hit is a stronger determinism guarantee than temperature 0
  // alone, and skips the LLM call entirely on repeat requests.
  const cacheKey = REDIS_KEY.guideSteps(
    guideStepsCacheKey({ fn: "generateSteps", prompt, language, mode: options.mode || "initial", completedActions, elements: domPreview })
  );
  const cached = await redis.getJson<GenerateStepsResponse>(cacheKey);
  if (cached) return cached;

  const result = await (async (): Promise<GenerateStepsResponse | null> => {
    // Run OpenRouter and every Gemini key concurrently — the previous
    // sequential "try OpenRouter, THEN try Gemini key 1, THEN key 2" chain
    // meant a bad run (all providers slow/down) added every timeout
    // together (up to ~50s) before ever falling back to the instant local
    // heuristic generator. Racing them bounds the wait to the single
    // slowest attempt instead.
    const attempts: Promise<GenerateStepsResponse | null>[] = [];
    const failureReasons: string[] = [];

    const openRouter = getOpenRouterConfig(options.planTier);
    if (openRouter) {
      attempts.push(
        (async (): Promise<GenerateStepsResponse | null> => {
          try {
            const response = await fetch(openRouter.endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openRouter.apiKey}`,
                "HTTP-Referer": "https://guideme.cadt.edu.kh",
                "X-Title": "GuideMe Interactive Walkthrough",
              },
              body: JSON.stringify({
                model: openRouter.model,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userMessage },
                ],
                response_format: { type: "json_object" },
                // Deterministic: the same goal + DOM snapshot must always produce
                // the same steps. Any temperature above 0 lets the sampler pick a
                // different (sometimes wrong) target element or step ordering on
                // a repeat request for an identical intent.
                temperature: 0,
                max_tokens: 4096,
                reasoning: { effort: "minimal" },
              }),
              signal: AbortSignal.timeout(GUIDE_GENERATION_TIMEOUT_MS),
            });

            if (response.ok) {
              const data: any = await response.json();
              const jsonText = data.choices?.[0]?.message?.content;
              if (jsonText) {
                const parsed = JSON.parse(cleanJsonResponse(jsonText));
                if (parsed?.done === true) {
                  return { done: true, tutorial: { id: `llm-guide-done-${Date.now()}`, version: "1.0.0", name: "Completed", description: "The requested workflow is complete.", steps: [] } };
                }
                if (parsed?.tutorial?.steps?.length > 0) return parsed;
              }
              failureReasons.push("OpenRouter: response had no usable steps");
            } else {
              failureReasons.push(`OpenRouter: HTTP ${response.status}`);
            }
            return null;
          } catch (err: any) {
            const reason = err?.name === "TimeoutError" || err?.name === "AbortError"
              ? `timed out after ${GUIDE_GENERATION_TIMEOUT_MS}ms`
              : err?.message || "unknown error";
            console.warn("[AI Service] OpenRouter generate-steps failed:", reason);
            failureReasons.push(`OpenRouter: ${reason}`);
            return null;
          }
        })()
      );
    }

    // Cap to 2 keys — enough to cover a single quota-exhausted key without
    // stacking unbounded attempts. Both run in parallel with OpenRouter above.
    for (const geminiApiKey of geminiKeys.slice(0, 2)) {
      attempts.push(
        (async (): Promise<GenerateStepsResponse | null> => {
          try {
            const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
            const response = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: `${systemPrompt}\n\nPage Elements:\n${userMessage}` }] }],
                  // Deterministic — see the OpenRouter call above for why.
                  generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 4096 },
                }),
                signal: AbortSignal.timeout(GUIDE_GENERATION_TIMEOUT_MS),
              }
            );

            if (response.ok) {
              const data: any = await response.json();
              const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
              if (jsonText) {
                const parsed = JSON.parse(cleanJsonResponse(jsonText));
                if (parsed?.done === true) {
                  return { done: true, tutorial: { id: `llm-guide-done-${Date.now()}`, version: "1.0.0", name: "Completed", description: "The requested workflow is complete.", steps: [] } };
                }
                if (parsed?.tutorial?.steps?.length > 0) return parsed;
              }
              failureReasons.push(`Gemini ...${geminiApiKey.slice(-6)}: response had no usable steps`);
            } else {
              failureReasons.push(`Gemini ...${geminiApiKey.slice(-6)}: HTTP ${response.status}`);
            }
            return null;
          } catch (err: any) {
            const reason = err?.name === "TimeoutError" || err?.name === "AbortError"
              ? `timed out after ${GUIDE_GENERATION_TIMEOUT_MS}ms`
              : err?.message || "unknown error";
            console.warn(`[AI Service] Gemini key ...${geminiApiKey.slice(-6)} generate-steps failed:`, reason);
            failureReasons.push(`Gemini ...${geminiApiKey.slice(-6)}: ${reason}`);
            return null;
          }
        })()
      );
    }

    if (attempts.length === 0) {
      throw Object.assign(
        new Error("No AI provider is configured (missing OPENROUTER_API_KEY and GEMINI_API_KEY)."),
        { statusCode: 503, code: "NO_AI_PROVIDER_CONFIGURED" }
      );
    }

    const winner = await firstNonNull(attempts);
    if (winner) {
      if (Array.isArray(winner.tutorial?.steps) && winner.tutorial.steps.length > 0) {
        winner.tutorial.steps = mergeRedundantFocusThenTypeSteps(winner.tutorial.steps);
      }
      return winner;
    }

    // No silent substitute: every configured provider failed. Surface exactly
    // why instead of a generic "service unavailable" the caller can't act on.
    throw Object.assign(
      new Error(`All AI providers failed to generate steps: ${failureReasons.join("; ")}`),
      { statusCode: 502, code: "AI_GUIDE_GENERATION_FAILED" }
    );
  })();

  if (result) await redis.setJson(cacheKey, result, REDIS_TTL.GUIDE_STEPS);
  return result;
}
