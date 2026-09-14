import {
  hardenAndValidateTutorial,
  AIGuideResponseSchema,
  IntentRerankResponseSchema,
  ContextualAssistantResponseSchema,
} from "./ai-schema.validator.js";

/**
 * Strips reasoning tokens (<think>...</think>) and markdown code fences from LLM responses.
 */
export function cleanJsonResponse(rawText: string): string {
  if (!rawText) return "";
  let cleaned = rawText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const match = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match) {
    cleaned = match[1].trim();
  }
  return cleaned;
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
 */
export function getOpenRouterConfig(): { apiKey: string; model: string; endpoint: string; timeoutMs: number } | null {
  const apiKey = (process.env.OPENROUTER_API_KEY || process.env.WXT_AI_API_KEY || "").trim();
  if (!apiKey) return null;
  const endpoint = (process.env.OPENROUTER_BASE_URL || process.env.WXT_AI_ENDPOINT || "https://openrouter.ai/api/v1/chat/completions").trim();
  const model = (process.env.OPENROUTER_MODEL || process.env.WXT_AI_MODEL || "google/gemini-3.5-flash").trim();
  const timeoutMs = Number(process.env.OPENROUTER_TIMEOUT_MS) || 12000;
  return { apiKey, model, endpoint, timeoutMs };
}

export async function generateGuideSteps(
  prompt: string,
  category = "general",
  language = "km"
): Promise<AIGuideResponse> {
  const openRouter = getOpenRouterConfig();

  // 1. Try OpenRouter Universal AI Gateway (Top Priority)
  if (openRouter) {
    try {
      const systemInstruction = `You are an expert digital literacy tutor in Cambodia for the GuideMe application.
Generate a step-by-step interactive tutorial based on this user prompt: "${prompt}".
Language requested: ${language === "km" ? "Khmer (ß₧ùß₧╢ß₧ƒß₧╢ß₧üßƒÆß₧ÿßƒéß₧Ü)" : "English"}.
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
    for (const apiKey of geminiKeys) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
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
Language requested: ${language === "km" ? "Khmer (ß₧ùß₧╢ß₧ƒß₧╢ß₧üßƒÆß₧ÿßƒéß₧Ü)" : "English"}.
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
            generationConfig: { responseMimeType: "application/json" },
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

  const isShare = /\b(share|collaborat|invite|distribut|broadcast|publish|ß₧àßƒéß₧Çß₧Üßƒåß₧¢ßƒéß₧Ç|ß₧óß₧ëßƒÆß₧çß₧╛ß₧ë|ß₧òßƒÆß₧ƒß₧ûßƒÆß₧£ß₧òßƒÆß₧ƒß₧╢ß₧Ö)\b/i.test(text);
  const isSearch = /\b(search|find|lookup|query|explore|browse|filter|ß₧ƒßƒÆß₧£ßƒéß₧äß₧Üß₧Ç|ß₧Üß₧Ç)\b/i.test(text);
  const isAuth = /\b(login|log\s*in|sign\s*in|signin|register|signup|auth|ß₧àß₧╝ß₧¢|ß₧àß₧╗ßƒçß₧êßƒÆß₧ÿßƒäßƒç)\b/i.test(text);
  const isSettings = /\b(settings|setting|preference|config|profile|account|ß₧Çß₧╢ß₧Üß₧Çßƒåß₧Äß₧Åßƒï|ß₧éß₧Äß₧ôß₧╕)\b/i.test(text);
  const isExport = /\b(export|download|save|print|ß₧æß₧╢ß₧ëß₧Öß₧Ç|ß₧Üß₧ÇßƒÆß₧ƒß₧╢ß₧æß₧╗ß₧Ç)\b/i.test(text);
  const isNew = /\b(new|create|add|\+|compose|upload|ß₧öß₧äßƒÆß₧Çß₧╛ß₧Å|ß₧öß₧ôßƒÆß₧Éßƒéß₧ÿ)\b/i.test(text);

  if (isShare) {
    return { targetQuery: "Share", action: "click", role: "button", category: "share" };
  }
  if (isSearch) {
    return { targetQuery: "Search", action: "input", role: "input", category: "search" };
  }
  if (isAuth) {
    return { targetQuery: "Sign In", action: "click", role: "button", category: "auth" };
  }
  if (isSettings) {
    return { targetQuery: "Settings", action: "click", role: "button", category: "navigation" };
  }
  if (isExport) {
    return { targetQuery: "Export", action: "click", role: "button", category: "general" };
  }
  if (isNew) {
    return { targetQuery: "New", action: "click", role: "button", category: "general" };
  }

  // Strip conversational wrappers and extract the core UI label
  const clean = (intentPrompt || question)
    .replace(/^(yes\s+)?(please\s+)?(help\s+me\s+)?(to\s+)?(get\s+the\s+link\s+to\s+)?(how\s+to\s+)?(can\s+you\s+)?(show\s+me\s+)?(click\s+)?(open\s+)?(find\s+)?/i, "")
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim();
  const words = clean.split(/\s+/).filter((w) => w.length >= 3);
  const targetQuery = words[0] ? words[0].charAt(0).toUpperCase() + words[0].slice(1) : "Action";

  return {
    targetQuery,
    action: "click",
    role: "button",
    category: "general",
  };
}

export async function askContextualAssistant(
  question: string,
  context?: { guideTitle?: string; currentStep?: number; stepInstruction?: string },
  language = "km",
  image?: string
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

  const systemPrompt = `You are GuideMe AI Assistant, an expert interactive web walkthrough companion.
Current User Context:
${context?.guideTitle ? `Tutorial: "${context.guideTitle}"` : "General Webpage / App Navigation"}
${context?.currentStep ? `Current Step: ${context.currentStep}` : ""}
${image ? "The user also attached an image or screenshot (such as an error popup, target UI element, or screen capture). Examine visual details carefully and incorporate them directly into your guidance." : ""}

Analyze the User Question${image ? " and attached image" : ""}.
Determine if the user is asking to DO, FIND, SHARE, EDIT, or PERFORM something on the page (e.g. "how do I share doc", "help me get link to share", "click login", "where is settings", "search products", "export file") OR simply chatting / greeting.

If ACTIONABLE (user wants to perform or find something):
1. "triggerGuide": true
2. "intentPrompt": clean command string (e.g. "Share this document")
3. "intent": An object specifying the exact UI element to find:
   {
     "targetQuery": "Share", // The exact button/link/tab text to find on screen
     "action": "click",      // "click" or "input"
     "role": "button",       // "button" | "input" | "link" | "tab"
     "category": "share",    // "share" | "search" | "auth" | "navigation" | "general"
     "expectedInput": null
   }

If NOT ACTIONABLE (greetings like "hi", "hello", or thanking "thanks", or "who are you"):
1. "triggerGuide": false
2. "intentPrompt": null
3. "intent": null

Output MUST be ONLY valid JSON matching this schema:
For Actionable Questions:
{
  "answer": "Your friendly conversational answer in ${language === "km" ? "Khmer (ß₧ùß₧╢ß₧ƒß₧╢ß₧üßƒÆß₧ÿßƒéß₧Ü)" : "English"}",
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

  // 1. Try OpenRouter Universal AI Gateway (Top Priority ΓÇö zero quota bottleneck)
  const openRouter = getOpenRouterConfig();
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
    for (const geminiApiKey of geminiKeys) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
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
  const isGreeting =
    /\b(hi|hello|hey|heya|yo|hiya|howdy|sup|greetings|say\s*hi|say\s*hello|good\s*(morning|afternoon|evening|day))\b/i.test(question) ||
    /(ß₧ƒß₧╜ß₧ƒßƒÆß₧èß₧╕|ß₧çßƒåß₧Üß₧╢ß₧öß₧ƒß₧╜ß₧Ü|ß₧ƒß₧╜ß₧ƒßƒÆß₧Åß₧╕|ß₧çß₧ÿßƒÆß₧Üß₧╢ß₧öß₧ƒß₧╜ß₧Ü|ß₧áßƒüß₧íß₧╝|ß₧áß₧╢ß₧Ö)/.test(question);

  const isGratitude =
    /\b(thanks?|thank\s+you|thx|cheers)\b/i.test(question) ||
    /(ß₧óß₧Üß₧éß₧╗ß₧Ä|ß₧ƒß₧╝ß₧ÿß₧óß₧Üß₧éß₧╗ß₧Ä)/.test(question);

  const isIdentity =
    /\b(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+guideme)\b/i.test(question) ||
    /(ß₧óßƒÆß₧ôß₧Çß₧çß₧╢ß₧óßƒÆß₧ôß₧Çß₧Äß₧╢|ß₧Åß₧╛ß₧óßƒÆß₧ôß₧Çß₧óß₧╢ß₧àß₧ÆßƒÆß₧£ß₧╛ß₧óßƒÆß₧£ß₧╕ß₧öß₧╢ß₧ô|ß₧Åß₧╛\s*guideme\s*ß₧çß₧╢ß₧óßƒÆß₧£ß₧╕)/.test(question);

  const isActionable = Boolean(image) || (
    !isGreeting && !isGratitude && !isIdentity && (
      /\b(share|click|open|find|search|edit|save|login|sign|send|upload|download|export|how to|help me|can you|show me|error|fix)\b/i.test(question) ||
      /(ß₧àßƒéß₧Çß₧Üßƒåß₧¢ßƒéß₧Ç|ß₧àß₧╗ß₧à|ß₧öß₧╛ß₧Ç|ß₧ƒßƒÆß₧£ßƒéß₧äß₧Üß₧Ç|ß₧Çßƒé|ß₧Üß₧ÇßƒÆß₧ƒß₧╢ß₧æß₧╗ß₧Ç|ß₧àß₧╝ß₧¢|ß₧òßƒÆß₧ëß₧╛|ß₧æß₧╢ß₧ëß₧Öß₧Ç|ß₧Üß₧ößƒÇß₧ö|ß₧çß₧╜ß₧Ö|ß₧Çßƒåß₧áß₧╗ß₧ƒ|ß₧èßƒäßƒçß₧ƒßƒÆß₧Üß₧╢ß₧Ö)/.test(question)
    )
  );

  let fallbackIntent: AssistantIntentInstruction | null = null;
  if (isActionable) {
    const isSearch = /\b(search|find|ß₧ƒßƒÆß₧£ßƒéß₧äß₧Üß₧Ç|ß₧Üß₧Ç)\b/i.test(question);
    const isShare = /\b(share|invite|ß₧àßƒéß₧Çß₧Üßƒåß₧¢ßƒéß₧Ç)\b/i.test(question);
    const isAuth = /\b(login|sign\s*in|register|ß₧àß₧╝ß₧¢)\b/i.test(question);
    const isSettings = /\b(settings|profile|account|ß₧Çß₧╢ß₧Üß₧Çßƒåß₧Äß₧Åßƒï)\b/i.test(question);

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
        ? `ß₧ƒß₧╜ß₧ƒßƒÆß₧Åß₧╕ ${targetName}! ß₧üßƒÆß₧ëß₧╗ßƒåß₧çß₧╢ GuideMe AI Assistantßƒö ß₧Åß₧╛ß₧üßƒÆß₧ëß₧╗ßƒåß₧óß₧╢ß₧àß₧çß₧╜ß₧Öß₧óßƒÆß₧£ß₧╕ß₧óßƒÆß₧ôß₧Çß₧ôßƒàß₧¢ß₧╛ß₧æßƒåß₧ûßƒÉß₧Üß₧ôßƒüßƒç?`
        : `ß₧ƒß₧╜ß₧ƒßƒÆß₧èß₧╕! ß₧üßƒÆß₧ëß₧╗ßƒåß₧çß₧╢ GuideMe AI Assistantßƒö ß₧Åß₧╛ß₧üßƒÆß₧ëß₧╗ßƒåß₧óß₧╢ß₧àß₧çß₧╜ß₧Öß₧Äßƒéß₧ôß₧╢ßƒåß₧óßƒÆß₧£ß₧╕ß₧üßƒÆß₧¢ßƒçß₧èß₧¢ßƒïß₧óßƒÆß₧ôß₧Çß₧ôßƒàß₧¢ß₧╛ß₧æßƒåß₧ûßƒÉß₧Üß₧ôßƒüßƒç?`;
    } else if (isGratitude) {
      fallbackAnswer = `ß₧Üß₧╕ß₧Çß₧Üß₧╢ß₧Öß₧Äß₧╢ß₧ƒßƒïß₧èßƒéß₧¢ß₧öß₧╢ß₧ôß₧çß₧╜ß₧Ö! ß₧ößƒÆß₧Üß₧ƒß₧╖ß₧ôß₧öß₧╛ß₧óßƒÆß₧ôß₧Çß₧ÅßƒÆß₧Üß₧╝ß₧£ß₧Çß₧╢ß₧Üß₧çßƒåß₧ôß₧╜ß₧Öß₧òßƒÆß₧ƒßƒüß₧äß₧æßƒÇß₧Å ß₧ƒß₧╝ß₧ÿß₧ößƒÆß₧Üß₧╢ß₧ößƒïß₧üßƒÆß₧ëß₧╗ßƒåß₧öß₧╢ß₧ôß₧éßƒÆß₧Üß₧ößƒïß₧ûßƒüß₧¢ßƒö`;
    } else if (isIdentity) {
      fallbackAnswer = `ß₧üßƒÆß₧ëß₧╗ßƒåß₧çß₧╢ß₧çßƒåß₧ôß₧╜ß₧Öß₧Çß₧╢ß₧Ü GuideMe AIßƒö ß₧üßƒÆß₧ëß₧╗ßƒåß₧óß₧╢ß₧àß₧çß₧╜ß₧Öß₧Äßƒéß₧ôß₧╢ßƒåß₧óßƒÆß₧ôß₧Çß₧ÿß₧╜ß₧Öß₧çßƒåß₧áß₧╢ß₧ôß₧ÿßƒÆß₧Åß₧äßƒùß₧èßƒäß₧Öß₧öß₧äßƒÆß₧áß₧╢ß₧ëß₧ößƒèß₧╝ß₧Åß₧╗ß₧ä ß₧ôß₧╖ß₧äß₧Çß₧ôßƒÆß₧¢ßƒéß₧äß₧èßƒéß₧¢ß₧ÅßƒÆß₧Üß₧╝ß₧£ß₧ößƒåß₧ûßƒüß₧ëß₧ôßƒàß₧¢ß₧╛ß₧óßƒüß₧ÇßƒÆß₧Üß₧äßƒïß₧èßƒäß₧Öß₧òßƒÆß₧æß₧╢ß₧¢ßƒï!`;
    } else if (image) {
      fallbackAnswer = `ß₧üßƒÆß₧ëß₧╗ßƒåß₧öß₧╢ß₧ôß₧ûß₧╖ß₧ôß₧╖ß₧ÅßƒÆß₧Öß₧ÿß₧╛ß₧¢ß₧Üß₧╝ß₧öß₧ùß₧╢ß₧û/ß₧óßƒüß₧ÇßƒÆß₧Üß₧äßƒïß₧èßƒéß₧¢ß₧óßƒÆß₧ôß₧Çß₧öß₧╢ß₧ôß₧ùßƒÆß₧çß₧╢ß₧ößƒïß₧Üß₧╜ß₧àß₧áß₧╛ß₧Ö! ß₧òßƒÆß₧óßƒéß₧Çß₧¢ß₧╛ß₧ƒßƒåß₧Äß₧╜ß₧Ü "${question}"ßƒû ß₧üßƒÆß₧ëß₧╗ßƒåß₧Çßƒåß₧ûß₧╗ß₧äß₧öß₧äßƒÆß₧áß₧╢ß₧ëß₧ôß₧╖ß₧äß₧öß₧ëßƒÆß₧çß₧╢ß₧Çßƒïß₧¢ß₧╛ß₧ößƒèß₧╝ß₧Åß₧╗ß₧äß₧èßƒéß₧¢ß₧ûß₧╢ß₧Çßƒïß₧ûßƒÉß₧ôßƒÆß₧Æß₧ôßƒàß₧¢ß₧╛ß₧óßƒüß₧ÇßƒÆß₧Üß₧äßƒïß₧Üß₧öß₧ƒßƒïß₧óßƒÆß₧ôß₧Çßƒö`;
    } else if (isActionable) {
      fallbackAnswer = `ß₧üßƒÆß₧ëß₧╗ßƒåß₧Öß₧¢ßƒïß₧áß₧╛ß₧Ö! ß₧üßƒÆß₧ëß₧╗ßƒåß₧Çßƒåß₧ûß₧╗ß₧äß₧öß₧äßƒÆß₧áß₧╢ß₧ëß₧ôß₧╖ß₧äß₧öß₧ëßƒÆß₧çß₧╢ß₧Çßƒïß₧¢ß₧╛ß₧ößƒèß₧╝ß₧Åß₧╗ß₧äß₧ôßƒàß₧¢ß₧╛ß₧óßƒüß₧ÇßƒÆß₧Üß₧äßƒïß₧Üß₧öß₧ƒßƒïß₧óßƒÆß₧ôß₧Çß₧èß₧╛ß₧ÿßƒÆß₧öß₧╕ß₧çß₧╜ß₧Öß₧óßƒÆß₧ôß₧Ç "${question}"ßƒö`;
    } else {
      fallbackAnswer = `ß₧ôßƒüßƒçß₧çß₧╢ß₧ûßƒÉß₧Åßƒîß₧ÿß₧╢ß₧ôß₧æß₧╢ß₧Çßƒïß₧æß₧äß₧ôß₧╣ß₧ä "${question}"ßƒö ß₧ößƒÆß₧Üß₧ƒß₧╖ß₧ôß₧öß₧╛ß₧óßƒÆß₧ôß₧Çß₧àß₧äßƒïß₧▒ßƒÆß₧Öß₧üßƒÆß₧ëß₧╗ßƒåß₧öß₧äßƒÆß₧áß₧╢ß₧ëß₧ößƒèß₧╝ß₧Åß₧╗ß₧ä ß₧¼ß₧Çß₧╢ß₧Üß₧Çßƒåß₧Äß₧Åßƒïß₧çß₧╢ß₧Çßƒïß₧¢ß₧╢ß₧Çßƒïß₧ôßƒàß₧¢ß₧╛ß₧óßƒüß₧ÇßƒÆß₧Üß₧äßƒïß₧ôßƒüßƒç ß₧ƒß₧╝ß₧ÿß₧ößƒÆß₧Üß₧╢ß₧ößƒïß₧üßƒÆß₧ëß₧╗ßƒåß₧öß₧╢ß₧ô!`;
    }

    return {
      answer: fallbackAnswer,
      triggerGuide: isActionable,
      intentPrompt: isActionable ? question : undefined,
      intent: fallbackIntent,
      relatedTips: isGreeting
        ? [
            "ß₧ƒß₧╜ß₧Üß₧Üß₧ößƒÇß₧öß₧ößƒÆß₧Üß₧╛ß₧ößƒÆß₧Üß₧╢ß₧ƒßƒïß₧ÿß₧╗ß₧üß₧äß₧╢ß₧Üß₧ôß₧╢ß₧ôß₧╢",
            "ß₧ƒßƒÆß₧ôß₧╛ß₧ƒß₧╗ßƒåß₧▒ßƒÆß₧Öß₧öß₧äßƒÆß₧áß₧╢ß₧ëß₧òßƒÆß₧¢ß₧╝ß₧£ ß₧¼ß₧ƒßƒÆß₧£ßƒéß₧äß₧Üß₧Çß₧ößƒèß₧╝ß₧Åß₧╗ß₧äß₧ôßƒàß₧¢ß₧╛ß₧æßƒåß₧ûßƒÉß₧Ü",
          ]
        : [
            "ß₧ûß₧╖ß₧ôß₧╖ß₧ÅßƒÆß₧Öß₧ƒß₧╢ß₧Üß₧Çßƒåß₧áß₧╗ß₧ƒß₧ôßƒàß₧¢ß₧╛ß₧Üß₧╝ß₧öß₧ùß₧╢ß₧û ß₧¼ß₧óßƒüß₧ÇßƒÆß₧Üß₧äßƒï",
            "ß₧àß₧╗ß₧àß₧ößƒèß₧╝ß₧Åß₧╗ß₧äß₧ƒßƒåß₧íßƒüß₧äß₧èß₧╛ß₧ÿßƒÆß₧öß₧╕ß₧ƒßƒÆß₧Åß₧╢ß₧ößƒïß₧Çß₧╢ß₧Üß₧Äßƒéß₧ôß₧╢ßƒåß₧çß₧╢ß₧ùß₧╢ß₧ƒß₧╢ß₧üßƒÆß₧ÿßƒéß₧Ü",
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
      title: `ß₧Çß₧╢ß₧Üß₧Äßƒéß₧ôß₧╢ßƒåßƒû ${prompt}`,
      description: `ß₧Çß₧╢ß₧Üß₧Äßƒéß₧ôß₧╢ßƒåß₧çß₧╢ß₧çßƒåß₧áß₧╢ß₧ôßƒùß₧ƒß₧ÿßƒÆß₧Üß₧╢ß₧ößƒï "${prompt}" ß₧èßƒéß₧¢ß₧öß₧äßƒÆß₧Çß₧╛ß₧Åß₧íß₧╛ß₧äß₧èßƒäß₧Öß₧ƒßƒÆß₧£ßƒÉß₧Öß₧ößƒÆß₧Üß₧£ß₧ÅßƒÆß₧Åß₧╖ßƒö`,
      category,
      steps: [
        {
          stepNumber: 1,
          title: "ß₧öß₧╛ß₧Çß₧òßƒÆß₧æß₧╢ßƒåß₧äß₧Çß₧ÿßƒÆß₧ÿß₧£ß₧╖ß₧Æß₧╕",
          instruction: "ß₧öß₧╛ß₧Çß₧Çß₧ÿßƒÆß₧ÿß₧£ß₧╖ß₧Æß₧╕ß₧èßƒéß₧¢ß₧óßƒÆß₧ôß₧Çß₧àß₧äßƒïß₧ößƒÆß₧Üß₧╛ ß₧áß₧╛ß₧Öß₧àß₧╝ß₧¢ß₧æßƒàß₧Çß₧╢ß₧ôßƒïß₧òßƒÆß₧æß₧╢ßƒåß₧äß₧èß₧╛ß₧ÿ (Home screen)ßƒö",
          hint: "ß₧ÅßƒÆß₧Üß₧╝ß₧£ß₧ößƒÆß₧Üß₧╢ß₧Çß₧èß₧Éß₧╢ß₧óßƒÆß₧ôß₧Çß₧öß₧╢ß₧ôß₧ùßƒÆß₧çß₧╢ß₧ößƒïß₧óßƒèß₧╕ß₧ôß₧Æß₧║ß₧Äß₧╖ß₧Åß₧Üß₧╜ß₧àß₧Üß₧╢ß₧¢ßƒïßƒö",
          targetElement: "nav-home",
        },
        {
          stepNumber: 2,
          title: "ß₧ƒßƒÆß₧£ßƒéß₧äß₧Üß₧Çß₧ößƒèß₧╝ß₧Åß₧╗ß₧äß₧ÿß₧╗ß₧üß₧äß₧╢ß₧Ü",
          instruction: `ß₧ƒßƒÆß₧£ßƒéß₧äß₧Üß₧Çß₧ÿß₧╗ß₧üß₧äß₧╢ß₧Üß₧æß₧╢ß₧Çßƒïß₧æß₧äß₧ôß₧╣ß₧ä "${prompt}" ß₧ôßƒàß₧¢ß₧╛ß₧ÿßƒëß₧║ß₧ôß₧╗ß₧Ö ß₧¼ß₧Üß₧öß₧╢ß₧Üß₧ƒßƒÆß₧£ßƒéß₧äß₧Üß₧Çßƒö`,
          hint: "ß₧ƒß₧ÿßƒÆß₧¢ß₧╣ß₧äß₧ÿß₧╛ß₧¢ß₧Üß₧╝ß₧öß₧Åßƒåß₧Äß₧╢ß₧ä (Icons) ß₧èßƒéß₧¢ß₧ÿß₧╢ß₧ôß₧ƒßƒÆß₧¢ß₧╢ß₧Çß₧êßƒÆß₧ÿßƒäßƒçß₧àßƒÆß₧öß₧╢ß₧ƒßƒïß₧¢ß₧╢ß₧ƒßƒïßƒö",
          targetElement: "search-input",
        },
        {
          stepNumber: 3,
          title: "ß₧ößƒåß₧ûßƒüß₧ëß₧ûßƒÉß₧Åßƒîß₧ÿß₧╢ß₧ôß₧èßƒéß₧¢ß₧ÅßƒÆß₧Üß₧╝ß₧£ß₧Çß₧╢ß₧Ü",
          instruction: "ß₧£ß₧╢ß₧Öß₧öß₧ëßƒÆß₧àß₧╝ß₧¢ß₧ûßƒÉß₧Åßƒîß₧ÿß₧╢ß₧ôß₧Åß₧╢ß₧ÿß₧Çß₧╢ß₧Üß₧Äßƒéß₧ôß₧╢ßƒåß₧ôßƒàß₧¢ß₧╛ß₧óßƒüß₧ÇßƒÆß₧Üß₧äßƒï ß₧áß₧╛ß₧Öß₧ûß₧╖ß₧ôß₧╖ß₧ÅßƒÆß₧Öß₧íß₧╛ß₧äß₧£ß₧╖ß₧ëß₧èßƒäß₧Öß₧ößƒÆß₧Üß₧╗ß₧äß₧ößƒÆß₧Üß₧ÖßƒÉß₧ÅßƒÆß₧ôßƒö",
          hint: "ß₧Çß₧╗ßƒåß₧àßƒéß₧Çß₧Üßƒåß₧¢ßƒéß₧Çß₧¢ßƒüß₧üß₧ƒß₧ÿßƒÆß₧äß₧╢ß₧Åßƒï (PIN/Password) ß₧æßƒàß₧Çß₧╢ß₧ôßƒïß₧óßƒÆß₧ôß₧Çß₧èß₧æßƒâßƒö",
          targetElement: "form-input",
        },
        {
          stepNumber: 4,
          title: "ß₧àß₧╗ß₧àß₧öß₧ëßƒÆß₧çß₧╢ß₧Çßƒïß₧èß₧╛ß₧ÿßƒÆß₧öß₧╕ß₧öß₧ëßƒÆß₧àß₧ößƒï",
          instruction: "ß₧àß₧╗ß₧àß₧ößƒèß₧╝ß₧Åß₧╗ß₧ä 'ß₧Öß₧¢ßƒïß₧ûßƒÆß₧Üß₧ÿ' ß₧¼ 'ß₧öß₧ôßƒÆß₧Å' ß₧èß₧╛ß₧ÿßƒÆß₧öß₧╕ß₧öß₧ëßƒÆß₧àß₧ößƒïß₧ößƒÆß₧Üß₧Åß₧╖ß₧öß₧ÅßƒÆß₧Åß₧╖ß₧Çß₧╢ß₧Üß₧èßƒäß₧Öß₧çßƒäß₧éß₧çßƒÉß₧Ößƒö",
          hint: "ß₧óßƒÆß₧ôß₧Çß₧óß₧╢ß₧àß₧Éß₧Åß₧óßƒüß₧ÇßƒÆß₧Üß₧äßƒïß₧æß₧╗ß₧Çß₧çß₧╢ß₧ùß₧ƒßƒÆß₧Åß₧╗ß₧Åß₧╢ß₧äßƒö",
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
}): Promise<any> {
  const { prompt, elements, url = "", language = "km" } = params;

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
   - If reaching the goal requires navigating through a menu, dropdown, sidebar, or dialog (e.g. File ΓåÆ Page Setup, Settings ΓåÆ General, Actions ΓåÆ Export):
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

  const userContent = `Page URL: ${url || "webpage"}
User Request / Goal: "${prompt}"

Interactive DOM Elements on page:
${JSON.stringify(elements.slice(0, 400), null, 2)}

Generate the interactive tutorial JSON now.`;

  // ΓöÇΓöÇ 0. Try OpenRouter Universal AI Gateway (Top Priority) ΓöÇΓöÇ
  const openRouter = getOpenRouterConfig();
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
            { role: "system", content: systemInstruction },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 4096,
        }),
        signal: AbortSignal.timeout(openRouter.timeoutMs),
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
    } catch (err: any) {
      console.warn("[AI Service] OpenRouter DOM generation error, falling back to Gemini:", err?.message);
    }
  }

  // ΓöÇΓöÇ 1. Try Gemini API (Primary Sub-second Provider) ΓöÇΓöÇ
  if (geminiKeys.length > 0) {
    for (const geminiApiKey of geminiKeys) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
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
              temperature: 0.2,
            },
          }),
          signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS) || 3000),
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
      } catch (err: any) {
        console.warn(`[AI Service] Gemini key ...${geminiApiKey.slice(-6)} DOM generation error:`, err?.message);
      }
    }
  }



  // ΓöÇΓöÇ 3. Heuristic / Template Fallback ΓöÇΓöÇ
  return hardenAndValidateTutorial({}, elements, prompt);
}

export async function rerankIntentCandidates(
  prompt: string,
  candidates: CandidateDescriptor[]
): Promise<{ stepIds: string[] }> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { stepIds: [] };
  }

  const geminiKeys = getOrderedGeminiApiKeys();

  const systemPrompt =
    'You are an interactive tutorial engine. Given a user goal and UI candidates, return the 1 to 3 candidate IDs in order of interaction needed to fulfill the goal. Return ONLY valid JSON matching: {"stepIds": ["cand-0", ...]}';
  const userMessage = JSON.stringify({ userGoal: prompt, candidates });

  // 0. Try OpenRouter Universal AI Gateway (Top Priority)
  const openRouter = getOpenRouterConfig();
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
    for (const geminiApiKey of geminiKeys) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
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
}

/**
 * Stage 1: Validates user intent via LLM and optionally plans multi-page steps.
 * Uses OpenRouter first, Gemini fallback. If both fail, asks the user to clarify.
 */
export async function validateIntent(
  prompt: string,
  currentUrl: string = "",
  language: string = "km"
): Promise<ValidatedIntent> {
  const openrouterKey = (process.env.OPENROUTER_API_KEY || process.env.WXT_AI_API_KEY || "").trim();
  const geminiKeys = getOrderedGeminiApiKeys();

  // Quick-pass: known greeting patterns → skip LLM entirely
  const trimmed = prompt.trim().toLowerCase();
  const greetings = /^(hi|hello|hey|yo|sup|howdy|hiya|good\s*(morning|afternoon|evening)|សួស្ដី|ជំរាបសួរ|ហេឡូ|ហាយ)[\s!.,។?]*$/i;
  if (greetings.test(trimmed)) {
    const reply = language === "km"
      ? "សួស្ដី! តើអ្នកចង់ឱ្យខ្ញុំជួយអ្វីលើទំព័រនេះ?"
      : "Hi! What would you like help with on this page?";
    return { valid: false, reason: reply, pages: [] };
  }

  // Quick-pass: known unclear patterns → skip LLM
  const unclear = /^(help|help me|do something|please|ok|okay|yes|no|thanks|thank you|idk|hmm|huh|what|why|how|show me|tell me|guide me|ជួយ|សូម|អរគុណ|អ្វី|ហេតុអ្វី)[\s!.,។?]*$/i;
  if (unclear.test(trimmed)) {
    const reply = language === "km"
      ? "សូមបញ្ជាក់អ្វីដែលអ្នកចង់ធ្វើ ឧទាហរណ៍៖ \"ចុចប៊ូតុង Login\""
      : "Please specify what you want to do. Example: \"Click the Login button\"";
    return { valid: false, reason: reply, pages: [] };
  }

  // Quick-pass: known action verbs → skip LLM, assume valid
  const actionVerbs = /\b(click|press|tap|open|go\s*to|navigate|search|find|type|enter|fill|submit|save|buy|add|remove|delete|edit|create|sign\s*in|log\s*in|sign\s*up|register|checkout|download|upload|share|invite|send|select|choose|export|import|print|scroll|help\s*me\s*(share|click|open|find|search|login|edit)|how\s*to|i\s*want\s*to|i\s*need\s*to|ចុច|បើក|ទៅ|ស្វែងរក|វាយ|បញ្ចូល|រក្សាទុក|ទិញ|បន្ថែម|លុប|កែ|បង្កើត|ចូល|ចុះឈ្មោះ|ទាញយក|ផ្ញើ|ជ្រើសរើស|មើល|ចែករំលែក|កំណត់|ជួយ\s*(ខ្ញុំ)?\s*(ចែករំលែក|រក|បើក|ចុច|ផ្ញើ|បង្កើត|កែ|ចូល))\b/i;
  if (actionVerbs.test(prompt)) {
    return { valid: true, reason: "", pages: [{ route: "current", action: "user_intent", target: "", description: prompt }] };
  }

  const lang = language === "km" ? "Khmer" : "English";
  const systemPrompt = `You validate user intents for GuideMe, a browser tutorial assistant. Respond as JSON.

Rules:
- User can type Khmer/English/mixed with typos. Be tolerant.
- If the request is about doing something on a webpage → valid: true, plan pages needed (usually one page with route "current").
- If greeting, chit-chat, or gibberish → valid: false, reason in ${lang} suggesting what to ask.

Schema:
{"valid":boolean,"reason":"string in ${lang}","pages":[{"route":"current","action":"string","target":"","description":"string"}]}`;

  const userMessage = JSON.stringify({ prompt, currentUrl, language });

  // Try OpenRouter first
  if (openrouterKey) {
    const openRouter = getOpenRouterConfig();
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
    for (const geminiApiKey of geminiKeys) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemPrompt}\n\n${userMessage}` }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
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
    ? "សូមអភ័យទោស ខ្ញុំមិនអាចផ្ទៀងផ្ទាត់សំណើរបស់អ្នកបានទេ។ សូមព្យាយាមម្តងទៀត ឧទាហរណ៍៖ \"ចុចប៊ូតុង Login\" ឬ \"how to change password\""
    : "Sorry, I couldn't validate your request. Please try again or be more specific. For example: \"click the Login button\" or \"how to change password\"";
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
  options: { mode?: "initial" | "next_action"; completedActions?: string[] } = {}
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

When choosing targets:
- Prefer the exact CSS selector from the provided element list when a matching element exists.
- If an intermediate action has no element in the provided list (e.g. a sub-menu that only appears after hovering), STILL emit the step with a best-effort CSS selector or the visible label text.
- Generate clear instructions in ${language === "km" ? "Khmer" : "English"}.
- For input fields, validation type = "input". For buttons/links, "click". For dropdowns, "change".
- If the requested action absolutely cannot be found on the screen, return a single step with action type "modal", title "Action Not Found", and a description explicitly stating that you cannot locate the requested element (do NOT hallucinate a target).
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
  });

  // Try OpenRouter first
  const openRouter = getOpenRouterConfig();
  if (openRouter) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), openRouter.timeoutMs);
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
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

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
      }
    } catch (err: any) {
      console.warn("[AI Service] OpenRouter generate-steps failed, trying Gemini:", err?.message);
    }
  }

  // Fallback: Gemini rotating pool
  if (geminiKeys.length > 0) {
    for (const geminiApiKey of geminiKeys) {
      try {
        const model = process.env.GEMINI_MODEL || "gemini-3-flash-preview";
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemPrompt}\n\nPage Elements:\n${userMessage}` }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
            }),
            signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS) || 12000),
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
        }
      } catch (err: any) {
        console.warn(`[AI Service] Gemini key ...${geminiApiKey.slice(-6)} generate-steps failed:`, err?.message);
      }
    }
  }

  return null;
}
