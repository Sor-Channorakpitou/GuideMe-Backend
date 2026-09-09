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

  const isShare = /\b(share|collaborat|invite|distribut|broadcast|publish|ចែករំលែក|អញ្ជើញ|ផ្សព្វផ្សាយ)\b/i.test(text);
  const isSearch = /\b(search|find|lookup|query|explore|browse|filter|ស្វែងរក|រក)\b/i.test(text);
  const isAuth = /\b(login|log\s*in|sign\s*in|signin|register|signup|auth|ចូល|ចុះឈ្មោះ)\b/i.test(text);
  const isSettings = /\b(settings|setting|preference|config|profile|account|ការកំណត់|គណនី)\b/i.test(text);
  const isExport = /\b(export|download|save|print|ទាញយក|រក្សាទុក)\b/i.test(text);
  const isNew = /\b(new|create|add|\+|compose|upload|បង្កើត|បន្ថែម)\b/i.test(text);

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
  const nvidiaApiKey = process.env.NVIDIA_API_KEY;
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

  // 3. Fallback: Try NVIDIA AI NIM (Kimi-K3 or Vision)
  if (nvidiaApiKey) {
    try {
      const endpoint = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
      const model = process.env.NVIDIA_MODEL || "moonshotai/kimi-k3";

      const userContent = image
        ? [
            { type: "text", text: question },
            {
              type: "image_url",
              image_url: {
                url: image.startsWith("data:") ? image : `data:image/png;base64,${image}`,
              },
            },
          ]
        : question;

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${nvidiaApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          temperature: 0.2,
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(Number(process.env.NVIDIA_TIMEOUT_MS) || 2500),
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
      }
    } catch (err: any) {
      console.warn("[AI Assistant] NVIDIA NIM failed, using smart fallback:", err?.message);
    }
  }

  // 3. Smart Heuristic Fallback (Offline / Failover)
  const isGreeting =
    /\b(hi|hello|hey|heya|yo|hiya|howdy|sup|greetings|say\s*hi|say\s*hello|good\s*(morning|afternoon|evening|day))\b/i.test(question) ||
    /(សួស្ដី|ជំរាបសួរ|សួស្តី|ជម្រាបសួរ|ហេឡូ|ហាយ)/.test(question);

  const isGratitude =
    /\b(thanks?|thank\s+you|thx|cheers)\b/i.test(question) ||
    /(អរគុណ|សូមអរគុណ)/.test(question);

  const isIdentity =
    /\b(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+is\s+guideme)\b/i.test(question) ||
    /(អ្នកជាអ្នកណា|តើអ្នកអាចធ្វើអ្វីបាន|តើ\s*guideme\s*ជាអ្វី)/.test(question);

  const isActionable = Boolean(image) || (
    !isGreeting && !isGratitude && !isIdentity && (
      /\b(share|click|open|find|search|edit|save|login|sign|send|upload|download|export|how to|help me|can you|show me|error|fix)\b/i.test(question) ||
      /(ចែករំលែក|ចុច|បើក|ស្វែងរក|កែ|រក្សាទុក|ចូល|ផ្ញើ|ទាញយក|របៀប|ជួយ|កំហុស|ដោះស្រាយ)/.test(question)
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
 * using NVIDIA AI NIM (moonshotai/kimi-k3) or Google Gemini.
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

  const nvidiaApiKey = process.env.NVIDIA_API_KEY;
  const geminiKeys = getOrderedGeminiApiKeys();

  const systemInstruction = `You are GuideMe AI, an expert interactive web walkthrough and DOM guidance engine.
Your mission is to inspect the provided interactive DOM elements from a webpage and the user's intent, and generate a step-by-step interactive tutorial flow adhering strictly to GuideMe's JSON schema.

Requirements:
1. Select ONLY elements from the provided interactive DOM elements list.
2. For each step:
   - "id": unique string identifier (e.g. "step_1", "step_2")
   - "target": {
       "css": exact CSS selector from the candidate list (e.g. "#search-box", ".login-btn"),
       "text": element text if present,
       "ariaLabel": ariaLabel if present,
       "testId": testId if present
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
   - "title": Bilingual object { "km": "...", "en": "..." }
   - "description": Bilingual object { "km": "...", "en": "..." }
3. GuideMe is Khmer-First: "km" (Khmer) must be natural, accurate, and beginner-friendly. "en" (English) is secondary.
4. Output MUST be ONLY pure valid JSON (no surrounding markdown text, no conversational filler) matching:
{
  "id": "nvidia-guide-${Date.now()}",
  "version": "1.0.0",
  "name": { "km": "...", "en": "..." },
  "description": { "km": "...", "en": "..." },
  "matchUrls": ["<all_urls>"],
  "steps": [ ... ]
}`;

  const userContent = `Page URL: ${url || "webpage"}
User Request / Goal: "${prompt}"

Interactive DOM Elements on page:
${JSON.stringify(elements.slice(0, 80), null, 2)}

Generate the interactive tutorial JSON now.`;

  // ── 0. Try OpenRouter Universal AI Gateway (Top Priority) ──
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

  // ── 1. Try Gemini API (Primary Sub-second Provider) ──
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

  // ── 2. Fallback: Try NVIDIA AI NIM ──
  if (nvidiaApiKey) {
    try {
      const endpoint = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
      const model = process.env.NVIDIA_MODEL || "moonshotai/kimi-k3";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${nvidiaApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemInstruction },
            { role: "user", content: userContent },
          ],
          temperature: 0.2,
          max_tokens: 4096,
          stream: false,
        }),
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
        console.warn(`[AI Service] NVIDIA NIM returned HTTP ${response.status}:`, errText.slice(0, 200));
      }
    } catch (err: any) {
      console.warn("[AI Service] NVIDIA NIM fallback generation error:", err?.message);
    }
  }

  // ── 3. Heuristic / Template Fallback ──
  return hardenAndValidateTutorial({}, elements, prompt);
}

export async function rerankIntentCandidates(
  prompt: string,
  candidates: CandidateDescriptor[]
): Promise<{ stepIds: string[] }> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { stepIds: [] };
  }

  const nvidiaApiKey = process.env.NVIDIA_API_KEY;
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

  // 2. Fallback: Try NVIDIA NIM
  if (nvidiaApiKey) {
    try {
      const endpoint = process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1/chat/completions";
      const model = process.env.NVIDIA_MODEL || "moonshotai/kimi-k3";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${nvidiaApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: 0.1,
          max_tokens: 512,
        }),
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
    } catch (err) {
      console.warn("[AI Service] NVIDIA NIM reranking failed, using fallback ranking:", err);
    }
  }

  // Fallback: Return top candidates up to 3
  return {
    stepIds: candidates.slice(0, 3).map((c) => c.id),
  };
}

