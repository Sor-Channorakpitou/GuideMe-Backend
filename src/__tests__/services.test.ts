import { describe, it, expect } from "vitest";
import { generateGuideSteps, askContextualAssistant } from "../services/ai.service.js";
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
