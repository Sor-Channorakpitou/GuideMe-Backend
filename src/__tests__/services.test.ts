import { describe, it, expect } from "vitest";
import {
  generateGuideSteps,
  askContextualAssistant,
  getGeminiApiKeys,
  getOrderedGeminiApiKeys,
  resetGeminiKeyCounter,
  guideStepsCacheKey,
  mergeRedundantFocusThenTypeSteps,
} from "../services/ai.service.js";
import { synthesizeSpeech } from "../services/tts.service.js";
import { getFaqList } from "../services/support.service.js";

describe("GuideMe 4-Layer Service Tests", () => {
  describe("AI Service", () => {
    it("should generate a fallback guide structure with steps when prompt is given", async () => {
      const guide = await generateGuideSteps("How to use ABA Pay", "banking", "km");
      expect(guide).toBeDefined();
      expect(guide.title).toContain("ABA Pay");
      expect(Array.isArray(guide.steps)).toBe(true);
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.steps[0].instruction).toBeDefined();
    });

    it("should generate english guide steps when requested", async () => {
      const guide = await generateGuideSteps("Transfer money", "banking", "en");
      expect(guide).toBeDefined();
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.steps[0].stepNumber).toBe(1);
    });

    it("should answer contextual questions with helpful advice", async () => {
      const res = await askContextualAssistant("Where do I click?", { guideTitle: "ABA Pay", currentStep: 2 }, "km");
      expect(res.answer).toBeDefined();
      expect(res.relatedTips?.length).toBeGreaterThan(0);
    });

    it("should respond with a friendly greeting and triggerGuide false for greeting prompts", async () => {
      const enRes = await askContextualAssistant("say hi 22 3 to me", undefined, "en");
      expect(enRes.triggerGuide).toBe(false);
      expect(enRes.answer.toLowerCase()).toMatch(/(hi|hello|guideme)/);
      expect(enRes.answer).not.toContain("Please check the highlighted element");

      const kmRes = await askContextualAssistant("សួស្តីបង", undefined, "km");
      expect(kmRes.triggerGuide).toBe(false);
      expect(kmRes.answer).toMatch(/(សួស្តី|សួស្ដី|GuideMe)/);
      expect(kmRes.answer).not.toContain("សូមពិនិត្យមើលការណែនាំនៅលើអេក្រង់");
    });

    it("should handle gratitude and identity gracefully without triggering guide", async () => {
      const thanksRes = await askContextualAssistant("thanks a lot", undefined, "en");
      expect(thanksRes.triggerGuide).toBe(false);
      expect(thanksRes.answer.toLowerCase()).toMatch(/(welcome|help)/);

      const identityRes = await askContextualAssistant("who are you", undefined, "en");
      expect(identityRes.triggerGuide).toBe(false);
      expect(identityRes.answer.toLowerCase()).toMatch(/(guideme|assistant)/);
    });

    it("should resolve multiple Gemini API keys and rotate them round-robin across requests", () => {
      // Use isolated fake keys for this assertion rather than whatever real
      // GEMINI_API_KEY/GEMINI_API_KEY_2 happen to be configured in the
      // environment — a previous version of this test hardcoded a fragment
      // of the real key value, which leaked live credential material into
      // git history. Never assert against real secret values in tests.
      const originalKey1 = process.env.GEMINI_API_KEY;
      const originalKey2 = process.env.GEMINI_API_KEY_2;
      process.env.GEMINI_API_KEY = "test-fake-gemini-key-1";
      process.env.GEMINI_API_KEY_2 = "test-fake-gemini-key-2";

      try {
        resetGeminiKeyCounter();
        const keys = getGeminiApiKeys();
        expect(keys.length).toBeGreaterThanOrEqual(2);
        expect(keys[0]).toBe("test-fake-gemini-key-1");
        expect(keys[1]).toBe("test-fake-gemini-key-2");

        const call1 = getOrderedGeminiApiKeys();
        const call2 = getOrderedGeminiApiKeys();
        const call3 = getOrderedGeminiApiKeys();

        expect(call1[0]).toBe(keys[0]);
        expect(call2[0]).toBe(keys[1]);
        expect(call3[0]).toBe(keys[0]);
      } finally {
        process.env.GEMINI_API_KEY = originalKey1;
        process.env.GEMINI_API_KEY_2 = originalKey2;
        resetGeminiKeyCounter();
      }
    });

    it("should hash guide-step cache keys deterministically regardless of key order", () => {
      const a = guideStepsCacheKey({
        prompt: "Share this document",
        language: "km",
        elements: [{ tag: "button", id: "share-btn", text: "Share" }],
      });
      const b = guideStepsCacheKey({
        elements: [{ text: "Share", id: "share-btn", tag: "button" }],
        language: "km",
        prompt: "Share this document",
      });
      expect(a).toBe(b);
      expect(a).toHaveLength(64); // sha256 hex digest
    });

    it("should produce different guide-step cache keys for different DOM snapshots", () => {
      const a = guideStepsCacheKey({
        prompt: "Share this document",
        elements: [{ tag: "button", id: "share-btn", text: "Share" }],
      });
      const b = guideStepsCacheKey({
        prompt: "Share this document",
        elements: [{ tag: "button", id: "different-btn", text: "Share" }],
      });
      expect(a).not.toBe(b);
    });

    it("should merge a click-to-focus step immediately followed by a type-into-it step on the same target", () => {
      const steps = [
        {
          id: "step-1",
          title: "Select the formula box",
          target: { css: "div.cell-input", text: "" },
          validation: { type: "click" },
        },
        {
          id: "step-2",
          title: "Type the SUM formula",
          target: { css: "div.cell-input", text: "" },
          validation: { type: "input" },
        },
      ];
      const merged = mergeRedundantFocusThenTypeSteps(steps);
      expect(merged).toHaveLength(1);
      expect(merged[0].title).toBe("Type the SUM formula");
      expect(merged[0].id).toBe("step-1");
    });

    it("should NOT merge steps with different targets", () => {
      const steps = [
        {
          id: "step-1",
          title: "Click File menu",
          target: { css: "#file-menu", text: "File" },
          validation: { type: "click" },
        },
        {
          id: "step-2",
          title: "Type the file name",
          target: { css: "#filename-input", text: "" },
          validation: { type: "input" },
        },
      ];
      const merged = mergeRedundantFocusThenTypeSteps(steps);
      expect(merged).toHaveLength(2);
    });

    it("should NOT merge two click steps on the same target (not a focus-then-type pair)", () => {
      const steps = [
        {
          id: "step-1",
          title: "Open the menu",
          target: { css: "#menu", text: "" },
          validation: { type: "click" },
        },
        {
          id: "step-2",
          title: "Open the menu again",
          target: { css: "#menu", text: "" },
          validation: { type: "click" },
        },
      ];
      const merged = mergeRedundantFocusThenTypeSteps(steps);
      expect(merged).toHaveLength(2);
    });
  });

  describe("TTS Service", () => {
    it("should return synthesis payload and SSML for Khmer text", async () => {
      const tts = await synthesizeSpeech({ text: "សូមស្វាគមន៍មកកាន់ GuideMe", language: "km" });
      expect(tts.text).toBe("សូមស្វាគមន៍មកកាន់ GuideMe");
      expect(tts.language).toBe("km");
      expect(tts.provider).toBeDefined();
    });

    it("should escape XML/SSML reserved characters in SSML payload", async () => {
      const tts = await synthesizeSpeech({ text: "GuideMe <Tips> & 'Tricks' \"Now\"", language: "en" });
      expect(tts.ssml).toBeDefined();
      expect(tts.ssml).toContain("&lt;Tips&gt; &amp; &apos;Tricks&apos; &quot;Now&quot;");
      expect(tts.ssml).not.toContain("<Tips>");
    });
  });

  describe("Support Service", () => {
    it("should return FAQs and support category filtering", () => {
      const allFaqs = getFaqList();
      expect(allFaqs.length).toBeGreaterThan(0);

      const generalFaqs = getFaqList("general");
      expect(generalFaqs.every((f) => f.category === "general")).toBe(true);
    });
  });
});
