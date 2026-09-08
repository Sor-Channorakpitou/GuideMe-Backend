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
          return JSON.parse(jsonText);
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
): Promise<{ answer: string; relatedTips?: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY;

  if (apiKey && process.env.GEMINI_API_KEY) {
    try {
      const systemPrompt = `You are GuideMe AI Assistant, a friendly and patient digital literacy helper for Cambodian users.
Current User Context:
${context?.guideTitle ? `Tutorial: "${context.guideTitle}"` : "General App Navigation"}
${context?.currentStep ? `Current Step: ${context.currentStep}` : ""}
${context?.stepInstruction ? `Step Instruction: "${context.stepInstruction}"` : ""}

Answer the user's question clearly and simply in ${language === "km" ? "Khmer" : "English"}.
Keep answers concise (2-4 sentences max), very encouraging and beginner-friendly.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
          }),
        }
      );

      if (response.ok) {
        const data: any = await response.json();
        const answerText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (answerText) {
          return {
            answer: answerText,
            relatedTips: [
              language === "km" ? "ចុចប៊ូតុងសំឡេងដើម្បីស្តាប់ការណែនាំ" : "Click the audio button to hear instructions",
              language === "km" ? "អ្នកអាចសួរខ្ញុំបន្ថែមប្រសិនបើមិនទាន់ច្បាស់" : "Feel free to ask more if anything is unclear",
            ],
          };
        }
      }
    } catch (err) {
      console.warn("[AI Assistant] Gemini API call failed, using smart fallback response:", err);
    }
  }

  // Fallback assistant response
  if (language === "km") {
    return {
      answer: `សម្រាប់ជំនួយអំពី "${question}"៖ សូមពិនិត្យមើលការណែនាំនៅលើអេក្រង់ ហើយចុចលើប្រអប់ដែលមានសញ្ញាពន្លឺពណ៌ខៀវ។ ប្រសិនបើមានបញ្ហា សូមចុចប៊ូតុង 'សាកល្បងម្តងទៀត'។`,
      relatedTips: [
        "ពិនិត្យការតភ្ជាប់អ៊ីនធឺណិតរបស់អ្នក",
        "ចុចប៊ូតុងសំឡេងដើម្បីស្តាប់ការណែនាំជាភាសាខ្មែរ",
      ],
    };
  }

  return {
    answer: `For help regarding "${question}": Please check the highlighted element on your screen and follow the indicated step. You can also re-listen to the voice guidance anytime.`,
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
export async function rerankIntentCandidates(
  prompt: string,
  candidates: CandidateDescriptor[]
): Promise<{ stepIds: string[] }> {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { stepIds: [] };
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY;

  if (apiKey && process.env.GEMINI_API_KEY) {
    try {
      const systemPrompt = `You are an interactive tutorial engine. Given a user goal and UI candidates, return the 1 to 3 candidate IDs in order of interaction needed to fulfill the goal. Return ONLY valid JSON matching: {"stepIds": ["cand-0", ...]}`;
      const userMessage = JSON.stringify({ userGoal: prompt, candidates });

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
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
          const parsed = JSON.parse(jsonText);
          if (Array.isArray(parsed.stepIds)) {
            const validIds = new Set(candidates.map((c) => c.id));
            const filtered = parsed.stepIds.filter((id: string) => validIds.has(id));
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
