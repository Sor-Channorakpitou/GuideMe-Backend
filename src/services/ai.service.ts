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

export async function generateGuideSteps(
  prompt: string,
  category = "general",
  language = "km"
): Promise<AIGuideResponse> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY;

  if (apiKey && process.env.GEMINI_API_KEY) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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

  // Smart fallback generator for offline or dev mode
  return generateFallbackGuide(prompt, category, language);
}

export async function askContextualAssistant(
  question: string,
  context?: { guideTitle?: string; currentStep?: number; stepInstruction?: string },
  language = "km"
): Promise<{ answer: string; triggerGuide: boolean; intentPrompt?: string; relatedTips?: string[] }> {
  const nvidiaApiKey = process.env.NVIDIA_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;

  const systemPrompt = `You are GuideMe AI Assistant, an expert interactive web walkthrough companion.
Current User Context:
${context?.guideTitle ? `Tutorial: "${context.guideTitle}"` : "General Webpage / App Navigation"}
${context?.currentStep ? `Current Step: ${context.currentStep}` : ""}

Analyze the User Question.
If the user is asking to DO, FIND, SHARE, EDIT, or PERFORM something on the page (e.g. "how do I share doc", "help me share...", "click login", "where is settings", "search products", "export file"), you MUST set "triggerGuide": true and provide "intentPrompt" with the clean actionable command.
If the user is just saying hello or asking an abstract informational question, set "triggerGuide": false.

Output MUST be ONLY valid JSON matching this schema:
{
  "answer": "Your friendly conversational answer in ${language === "km" ? "Khmer (ភាសាខ្មែរ)" : "English"}",
  "triggerGuide": boolean,
  "intentPrompt": "The actionable command string or null",
  "relatedTips": ["Tip 1", "Tip 2"]
}`;

  // 1. Try NVIDIA AI NIM (Kimi-K3)
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
            { role: "user", content: question },
          ],
          temperature: 0.2,
          max_tokens: 1024,
        }),
        signal: AbortSignal.timeout(3500),
      });

      if (response.ok) {
        const data: any = await response.json();
        const contentText = data.choices?.[0]?.message?.content;
        if (contentText) {
          const cleaned = cleanJsonResponse(contentText);
          const parsed = JSON.parse(cleaned);
          const validated = ContextualAssistantResponseSchema.safeParse(parsed);
          if (validated.success) {
            return {
              answer: validated.data.answer,
              triggerGuide: validated.data.triggerGuide,
              intentPrompt: validated.data.intentPrompt || question,
              relatedTips: validated.data.relatedTips,
            };
          }
        }
      }
    } catch (err: any) {
      console.warn("[AI Assistant] NVIDIA NIM failed, checking Gemini:", err?.message);
    }
  }

  // 2. Try Gemini API
  if (geminiApiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: `${systemPrompt}\n\nUser Question: ${question}` },
                ],
              },
            ],
            generationConfig: { responseMimeType: "application/json" },
          }),
          signal: AbortSignal.timeout(3500),
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
            return {
              answer: validated.data.answer,
              triggerGuide: validated.data.triggerGuide,
              intentPrompt: validated.data.intentPrompt || question,
              relatedTips: validated.data.relatedTips,
            };
          }
        }
      }
    } catch (err) {
      console.warn("[AI Assistant] Gemini API call failed, using smart fallback response:", err);
    }
  }

  // 3. Smart action heuristic fallback
  const isActionable = /\b(share|click|open|find|search|edit|save|login|sign|send|upload|download|export|how to|help me|can you|show me)\b/i.test(question) ||
    /(ចែករំលែក|ចុច|បើក|ស្វែងរក|កែ|រក្សាទុក|ចូល|ផ្ញើ|ទាញយក|របៀប|ជួយ)/.test(question);

  if (language === "km") {
    return {
      answer: isActionable
        ? `ខ្ញុំយល់ហើយ! ខ្ញុំកំពុងបង្ហាញនិងបញ្ជាក់លើប៊ូតុងនៅលើអេក្រង់របស់អ្នកដើម្បីជួយអ្នក "${question}"។`
        : `សម្រាប់ជំនួយអំពី "${question}"៖ សូមពិនិត្យមើលការណែនាំនៅលើអេក្រង់។`,
      triggerGuide: isActionable,
      intentPrompt: isActionable ? question : undefined,
      relatedTips: [
        "ពិនិត្យការតភ្ជាប់អ៊ីនធឺណិតរបស់អ្នក",
        "ចុចប៊ូតុងសំឡេងដើម្បីស្តាប់ការណែនាំជាភាសាខ្មែរ",
      ],
    };
  }

  return {
    answer: isActionable
      ? `Got it! I am spotlighting the relevant action on your screen to guide you step-by-step for "${question}".`
      : `For help regarding "${question}": Please check the highlighted element on your screen.`,
    triggerGuide: isActionable,
    intentPrompt: isActionable ? question : undefined,
    relatedTips: [
      "Ensure you are logged in to the correct account",
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
  const geminiApiKey = process.env.GEMINI_API_KEY;

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

  // ── 1. Try NVIDIA AI NIM (Free Kimi-K3 Endpoint) ──
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
      console.warn("[AI Service] NVIDIA NIM generation error, checking Gemini fallback:", err?.message);
    }
  }

  // ── 2. Try Gemini API Fallback ──
  if (geminiApiKey) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
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
      console.warn("[AI Service] Gemini fallback generation error:", err?.message);
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
  const geminiApiKey = process.env.GEMINI_API_KEY;

  const systemPrompt =
    'You are an interactive tutorial engine. Given a user goal and UI candidates, return the 1 to 3 candidate IDs in order of interaction needed to fulfill the goal. Return ONLY valid JSON matching: {"stepIds": ["cand-0", ...]}';
  const userMessage = JSON.stringify({ userGoal: prompt, candidates });

  // 1. Try NVIDIA NIM first if configured
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
      console.warn("[AI Service] NVIDIA NIM reranking failed, trying Gemini:", err);
    }
  }

  // 2. Try Gemini API
  if (geminiApiKey) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
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
    } catch (err) {
      console.warn("[AI Service] Gemini reranking failed, using fallback ranking:", err);
    }
  }

  // Fallback: Return top candidates up to 3
  return {
    stepIds: candidates.slice(0, 3).map((c) => c.id),
  };
}

