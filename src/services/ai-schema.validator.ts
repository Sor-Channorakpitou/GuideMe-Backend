import { z } from "zod";
import type { DomCandidate } from "./ai.service.js";

/**
 * Normalizes any text or localized object into a clean bilingual { km, en } structure.
 */
function normalizeBilingual(val: unknown, fallbackEn = "Action", fallbackKm = "សកម្មភាព"): { km: string; en: string } {
  if (!val) {
    return { km: fallbackKm, en: fallbackEn };
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return { km: fallbackKm, en: fallbackEn };
    return { km: trimmed, en: trimmed };
  }
  if (typeof val === "object" && val !== null) {
    const obj = val as Record<string, any>;
    const km = typeof obj.km === "string" && obj.km.trim() ? obj.km.trim() : (typeof obj.en === "string" ? obj.en.trim() : fallbackKm);
    const en = typeof obj.en === "string" && obj.en.trim() ? obj.en.trim() : (typeof obj.km === "string" ? obj.km.trim() : fallbackEn);
    return { km, en };
  }
  return { km: fallbackKm, en: fallbackEn };
}

export const BilingualTextSchema = z.union([
  z.object({
    km: z.string().min(1),
    en: z.string().min(1),
  }),
  z.string().min(1),
]).transform((val) => normalizeBilingual(val));

export const TargetSelectorSchema = z.object({
  css: z.string().min(1),
  text: z.string().optional(),
  ariaLabel: z.string().optional(),
  testId: z.string().optional(),
  description: z.string().optional(),
  fallbackCss: z.string().optional(),
  alternatives: z.array(z.string()).default([]),
  hoverTrigger: z.any().optional(),
  container: z.string().optional(),
});

export const ActionSchema = z.object({
  type: z.enum(["spotlight", "tooltip", "modal"]).catch("spotlight"),
  title: BilingualTextSchema.optional(),
  content: BilingualTextSchema.optional(),
  placement: z.enum(["bottom", "top", "left", "right", "center", "auto"]).catch("bottom"),
  actionText: BilingualTextSchema.optional(),
  coachTitle: BilingualTextSchema.optional(),
});

export const ValidationSchema = z.object({
  type: z.enum(["click", "input", "change", "submit", "manual_next"]).catch("click"),
  expectedValue: z.string().optional(),
  timeout: z.number().optional(),
});

export const StepSchema = z.object({
  id: z.string().min(1),
  title: BilingualTextSchema,
  description: BilingualTextSchema.optional(),
  target: TargetSelectorSchema,
  action: ActionSchema,
  validation: ValidationSchema,
  audio: z.object({
    text: BilingualTextSchema.optional(),
  }).optional(),
});

export const TutorialSchema = z.object({
  id: z.string().min(1),
  version: z.string().default("1.0.0"),
  name: BilingualTextSchema,
  description: BilingualTextSchema.optional(),
  matchUrls: z.array(z.string()).default(["<all_urls>"]),
  steps: z.array(StepSchema).min(1),
});

export const AIGuideResponseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().default("general"),
  steps: z.array(
    z.object({
      stepNumber: z.number(),
      title: z.string().min(1),
      instruction: z.string().min(1),
      hint: z.string().optional(),
      targetElement: z.string().optional(),
      targetDescription: z.string().optional(),
      alternatives: z.array(z.string()).optional(),
    })
  ).min(1),
});

export const IntentRerankResponseSchema = z.object({
  stepIds: z.array(z.string()),
});

export const AssistantIntentSchema = z.preprocess((val: any) => {
  if (val && typeof val === "object") {
    const targetQuery = val.targetQuery || val.target || val.query || val.element || val.targetElement || "action";
    return {
      ...val,
      targetQuery: typeof targetQuery === "string" ? targetQuery : String(targetQuery || "action"),
    };
  }
  return val;
}, z.object({
  targetQuery: z.string().min(1),
  action: z.enum(["click", "input", "change", "submit"]).catch("click"),
  role: z.enum(["button", "input", "link", "tab", "menuitem", "element"]).catch("button").optional(),
  category: z.string().optional(),
  expectedInput: z.string().optional(),
}));

export const ContextualAssistantResponseSchema = z.object({
  answer: z.string().min(1),
  triggerGuide: z.boolean().default(false),
  intentPrompt: z.string().optional().nullable(),
  intent: z.preprocess((val) => {
    if (!val || typeof val !== "object") return null;
    const res = AssistantIntentSchema.safeParse(val);
    return res.success ? res.data : null;
  }, AssistantIntentSchema.nullable().optional()),
  relatedTips: z.array(z.string()).default([]),
});

export type ValidatedTutorial = z.infer<typeof TutorialSchema>;
export type ValidatedStep = z.infer<typeof StepSchema>;

/**
 * Builds heuristic fallback CSS selectors for an element candidate.
 */
export function buildSelectorAlternatives(candidate: DomCandidate): string[] {
  const alts = new Set<string>();

  if (candidate.selector) {
    alts.add(candidate.selector);
  }
  if (candidate.testId) {
    alts.add(`[data-testid="${candidate.testId}"]`);
    alts.add(`[data-cy="${candidate.testId}"]`);
  }
  if (candidate.id) {
    alts.add(`#${candidate.id}`);
  }
  if (candidate.ariaLabel) {
    alts.add(`[aria-label*="${candidate.ariaLabel}"]`);
    alts.add(`[title*="${candidate.ariaLabel}"]`);
  }
  if (candidate.name) {
    alts.add(`[name="${candidate.name}"]`);
  }
  if (candidate.text && candidate.tag) {
    const cleanText = candidate.text.replace(/["'\\]/g, "").slice(0, 30);
    if (cleanText) {
      alts.add(`${candidate.tag}:has-text("${cleanText}")`);
    }
  }

  return Array.from(alts);
}

/**
 * Disambiguates and hardens step selectors against verified DOM candidates from the page.
 * If AI hallucinated a non-existent selector, finds the best real candidate and provides
 * fallback descriptions and alternative selectors.
 */
export function disambiguateAndHardenSteps(
  rawSteps: any[],
  candidates: DomCandidate[] = [],
  fallbackPrompt = ""
): any[] {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return [];
  }

  return rawSteps.map((rawStep, index) => {
    const stepId = rawStep.id || `step_${index + 1}`;
    const targetObj = rawStep.target || {};
    let primaryCss = typeof targetObj.css === "string" ? targetObj.css.trim() : "";
    let targetText = targetObj.text || "";
    let targetAria = targetObj.ariaLabel || "";
    let targetTestId = targetObj.testId || "";
    let fallbackCss = targetObj.fallbackCss || "";
    let alternatives: string[] = Array.isArray(targetObj.alternatives) ? [...targetObj.alternatives] : [];
    let description = targetObj.description || "";

    // 1. Direct match check against live DOM candidate elements
    const directMatch = candidates.find((c) => c.selector === primaryCss);

    if (directMatch) {
      targetText = targetText || directMatch.text || "";
      targetAria = targetAria || directMatch.ariaLabel || "";
      targetTestId = targetTestId || directMatch.testId || "";
      description = description || `[${directMatch.tag.toUpperCase()}] ${directMatch.text || directMatch.ariaLabel || directMatch.selector}`;
      const generatedAlts = buildSelectorAlternatives(directMatch);
      alternatives = Array.from(new Set([...alternatives, ...generatedAlts]));
    } else if (candidates.length > 0) {
      // 2. AI returned a non-existent or hallucinated CSS selector!
      // Find the closest real candidate element using heuristics:
      const stepTitleText = typeof rawStep.title === "object" ? `${rawStep.title?.en || ""} ${rawStep.title?.km || ""}` : (rawStep.title || "");
      const searchKeywords = `${targetText} ${targetAria} ${primaryCss} ${stepTitleText} ${fallbackPrompt}`.toLowerCase();

      // Heuristic 2a: Exact or case-insensitive text match
      let heuristicMatch = candidates.find((c) => {
        if (!c.text || !targetText) return false;
        return c.text.trim().toLowerCase() === targetText.trim().toLowerCase();
      });

      // Heuristic 2b: Aria-label or name match
      if (!heuristicMatch && targetAria) {
        heuristicMatch = candidates.find((c) => c.ariaLabel && c.ariaLabel.toLowerCase().includes(targetAria.toLowerCase()));
      }

      // Heuristic 2c: Search keywords inside candidate text or attributes
      if (!heuristicMatch) {
        heuristicMatch = candidates.find((c) => {
          const cText = (c.text || "").toLowerCase();
          const cAria = (c.ariaLabel || "").toLowerCase();
          return (
            (cText.length > 2 && searchKeywords.includes(cText)) ||
            (cAria.length > 2 && searchKeywords.includes(cAria)) ||
            (targetText && (cText.includes(targetText.toLowerCase()) || cAria.includes(targetText.toLowerCase())))
          );
        });
      }

      // Heuristic 2d: Type / role compatibility
      if (!heuristicMatch) {
        const isInputStep = rawStep.validation?.type === "input" || /type|input|fill|enter/i.test(stepTitleText);
        if (isInputStep) {
          heuristicMatch = candidates.find((c) => c.tag === "input" || c.tag === "textarea");
        } else {
          heuristicMatch = candidates.find((c) => c.tag === "button" || c.role === "button" || c.tag === "a");
        }
      }

      if (heuristicMatch) {
        // Replace non-existent primary selector with verified candidate selector
        fallbackCss = primaryCss;
        primaryCss = heuristicMatch.selector;
        targetText = targetText || heuristicMatch.text || "";
        targetAria = targetAria || heuristicMatch.ariaLabel || "";
        targetTestId = targetTestId || heuristicMatch.testId || "";
        description = `[${heuristicMatch.tag.toUpperCase()}] ${heuristicMatch.text || heuristicMatch.ariaLabel || heuristicMatch.selector} (Recovered from: ${fallbackCss})`;
        const generatedAlts = buildSelectorAlternatives(heuristicMatch);
        alternatives = Array.from(new Set([...alternatives, ...generatedAlts, fallbackCss].filter(Boolean)));
      } else {
        // Fallback description when no DOM candidate matches
        description = description || `Target element: ${targetText || primaryCss || "Interactive button or field"}`;
        if (primaryCss) {
          alternatives.push(primaryCss);
        }
        if (targetText) {
          alternatives.push(`button:has-text("${targetText.slice(0, 30)}")`);
        }
      }
    } else {
      // No candidates provided; ensure description and primaryCss are safe strings
      description = description || `Target element: ${targetText || primaryCss || "Interactive UI element"}`;
      if (primaryCss) alternatives.push(primaryCss);
    }

    // Ensure action object structure
    const rawAction = rawStep.action || {};
    const action = {
      type: rawAction.type || "spotlight",
      title: normalizeBilingual(rawAction.title || rawStep.title, "Step Action", "សកម្មភាពជំហាន"),
      content: normalizeBilingual(rawAction.content || rawStep.description, "Click this element to proceed", "ចុចលើប៊ូតុងនេះដើម្បីបន្ត"),
      placement: rawAction.placement || "bottom",
      actionText: normalizeBilingual(rawAction.actionText, "Click Here", "ចុចទីនេះ"),
    };

    // Ensure validation object structure
    const rawValidation = rawStep.validation || {};
    const validation = {
      type: rawValidation.type || (primaryCss.includes("input") ? "input" : "click"),
      expectedValue: rawValidation.expectedValue,
      timeout: rawValidation.timeout,
    };

    return {
      id: stepId,
      title: normalizeBilingual(rawStep.title, `Step ${index + 1}`, `ជំហានទី ${index + 1}`),
      description: normalizeBilingual(rawStep.description, "Follow the highlighted guide", "ធ្វើតាមការណែនាំដែលបានបន្លិច"),
      target: {
        css: primaryCss || "button, a, input",
        text: targetText || undefined,
        ariaLabel: targetAria || undefined,
        testId: targetTestId || undefined,
        description,
        fallbackCss: fallbackCss || undefined,
        alternatives: alternatives.length > 0 ? alternatives : undefined,
        hoverTrigger: targetObj.hoverTrigger,
        container: targetObj.container,
      },
      action,
      validation,
      audio: rawStep.audio,
    };
  });
}

/**
 * Validates, hardens, and repairs an AI-generated tutorial response using strict Zod schemas
 * and real interactive DOM candidates.
 */
export function hardenAndValidateTutorial(
  raw: any,
  candidates: DomCandidate[] = [],
  prompt = ""
): ValidatedTutorial {
  let tutorialObj = raw;

  if (typeof raw === "string") {
    try {
      const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/```(?:json)?\s*([\s\S]*?)\s*```/i, "$1").trim();
      tutorialObj = JSON.parse(cleaned);
    } catch {
      tutorialObj = {};
    }
  }

  if (!tutorialObj || typeof tutorialObj !== "object") {
    tutorialObj = {};
  }

  // Pre-normalize top-level fields
  const id = typeof tutorialObj.id === "string" && tutorialObj.id.trim() ? tutorialObj.id.trim() : `guide-${Date.now()}`;
  const version = typeof tutorialObj.version === "string" ? tutorialObj.version : "1.0.0";
  const name = normalizeBilingual(tutorialObj.name, `Guide: ${prompt || "Walkthrough"}`, `ការណែនាំ៖ ${prompt || "ដំណើរការ"}`);
  const description = normalizeBilingual(tutorialObj.description, `Interactive walkthrough for "${prompt || "task"}"`, `ការណែនាំជាជំហានៗសម្រាប់ "${prompt || "កិច្ចការ"}"`);
  const matchUrls = Array.isArray(tutorialObj.matchUrls) && tutorialObj.matchUrls.length > 0 ? tutorialObj.matchUrls : ["<all_urls>"];

  // Disambiguate and harden steps
  let steps = disambiguateAndHardenSteps(tutorialObj.steps, candidates, prompt);

  // If no valid steps after disambiguation, construct safe baseline steps from candidates
  if (steps.length === 0 && candidates.length > 0) {
    const firstElem = candidates[0];
    steps = [
      {
        id: "step_1",
        title: normalizeBilingual(null, `Click ${firstElem.text || firstElem.tag}`, `ចុចលើ ${firstElem.text || firstElem.tag}`),
        description: normalizeBilingual(null, "Perform the first step to continue", "អនុវត្តជំហានដំបូងដើម្បីបន្ត"),
        target: {
          css: firstElem.selector,
          text: firstElem.text,
          ariaLabel: firstElem.ariaLabel,
          testId: firstElem.testId,
          description: `[${firstElem.tag.toUpperCase()}] ${firstElem.text || firstElem.ariaLabel || firstElem.selector}`,
          alternatives: buildSelectorAlternatives(firstElem),
        },
        action: {
          type: "spotlight",
          title: normalizeBilingual(null, "Step 1", "ជំហានទី ១"),
          content: normalizeBilingual(null, `Click this element to proceed with "${prompt}"`, `ចុចលើប៊ូតុងនេះដើម្បីបន្ត "${prompt}"`),
          placement: "bottom",
          actionText: normalizeBilingual(null, "Click Here", "ចុចទីនេះ"),
        },
        validation: {
          type: firstElem.tag === "input" ? "input" : "click",
        },
      },
    ];
  }

  const normalizedPayload = {
    id,
    version,
    name,
    description,
    matchUrls,
    steps,
  };

  // Strict Zod parsing
  const parseResult = TutorialSchema.safeParse(normalizedPayload);
  if (parseResult.success) {
    return parseResult.data;
  }

  console.warn("[AI Schema Hardening] Zod validation auto-correcting:", parseResult.error.format());

  // Force-repaired fallback guarantees zero breakdown
  return {
    id,
    version,
    name,
    description,
    matchUrls,
    steps: steps.length > 0 ? steps : [
      {
        id: "step_fallback",
        title: normalizeBilingual(null, "Start Step", "ចាប់ផ្តើម"),
        target: {
          css: candidates[0]?.selector || "button, a, input",
          description: "Default fallback target",
          alternatives: ["button", "a"],
        },
        action: {
          type: "spotlight",
          placement: "bottom",
        },
        validation: {
          type: "click",
        },
      },
    ],
  };
}
