import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../index.js";
import prisma from "../config/db.js";

describe("GuideMe Backend QA Integration Tests", () => {
  const testUser = {
    name: "QA Tester",
    email: `qa_test_${Date.now()}@guideme.app`,
    password: "Password123!",
  };
  let authToken = "";
  let createdGuideId = "";

  afterAll(async () => {
    // Cleanup test user and guides
    try {
      await prisma.user.deleteMany({ where: { email: testUser.email } });
      if (createdGuideId) {
        await prisma.guide.deleteMany({ where: { id: createdGuideId } });
      }
    } catch {
      // ignore
    }
  });

  describe("1. System Health & Documentation", () => {
    it("GET /health should return 200 OK", async () => {
      const res = await request(app).get("/health");
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ok");
    });

    it("GET /api-docs.json should return valid OpenAPI schema", async () => {
      const res = await request(app).get("/api-docs.json");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.0.0");
      expect(res.body.info.title).toBe("GuideMe API");
    });

    it("GET /api/swagger.json should return OpenAPI schema for type generators", async () => {
      const res = await request(app).get("/api/swagger.json");
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe("3.0.0");
    });

    it("OPTIONS preflight should allow chrome-extension:// origins", async () => {
      const res = await request(app)
        .options("/api/user/progress")
        .set("Origin", "chrome-extension://gkkgcgloiohdceccgepkfkecpgcgpiom")
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "Content-Type, Authorization");

      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe("chrome-extension://gkkgcgloiohdceccgepkfkecpgcgpiom");
      expect(res.headers["access-control-allow-credentials"]).toBe("true");
    });
  });

  describe("2. Public Support & FAQ Endpoints", () => {
    it("GET /api/support/faq should return FAQ list", async () => {
      const res = await request(app).get("/api/support/faq");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });

    it("GET /api/support/faq?category=general should filter by category", async () => {
      const res = await request(app).get("/api/support/faq?category=general");
      expect(res.status).toBe(200);
      expect(res.body.every((f: any) => f.category === "general")).toBe(true);
    });

    it("POST /api/support/contact should create ticket and return 201", async () => {
      const res = await request(app)
        .post("/api/support/contact")
        .send({
          category: "general",
          subject: "Inquiry about GuideMe",
          message: "Hello, how does GuideMe handle Khmer fonts?",
          email: "tester@example.com",
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.subject).toBe("Inquiry about GuideMe");
    });
  });

  describe("3. Khmer & English Voice TTS Endpoint", () => {
    it("POST /api/tts/synthesize should synthesize audio / return SSML", async () => {
      const res = await request(app)
        .post("/api/tts/synthesize")
        .send({ text: "សូមស្វាគមន៍", language: "km", speed: "normal" });

      expect(res.status).toBe(200);
      expect(res.body.text).toBe("សូមស្វាគមន៍");
      expect(res.body.language).toBe("km");
      expect(res.body.provider).toBeDefined();
    });

    it("POST /api/tts/synthesize with missing text should return 400 validation error", async () => {
      const res = await request(app).post("/api/tts/synthesize").send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("4. Auth Flow & Session Management", () => {
    it("POST /api/auth/register should create a user and set cookies/token", async () => {
      const res = await request(app).post("/api/auth/register").send({
        name: testUser.name,
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email);

      // Extract set-cookie
      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
    });

    it("POST /api/auth/login should authenticate user and return token", async () => {
      const res = await request(app).post("/api/auth/login").send({
        email: testUser.email,
        password: testUser.password,
      });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe(testUser.email);

      const cookieHeader = res.headers["set-cookie"]?.[0] || "";
      const match = cookieHeader.match(/token=([^;]+)/);
      if (match) {
        authToken = match[1];
      }
    });

    it("GET /api/auth/me should return authenticated user profile", async () => {
      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testUser.email);
    });

    it("GET /api/user/profile should return user profile details", async () => {
      const res = await request(app)
        .get("/api/user/profile")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email).toBe(testUser.email);
      expect(res.body.hasPassword).toBe(true);
    });

    it("GET /api/user/stats should return stats", async () => {
      const res = await request(app)
        .get("/api/user/stats")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.totalGuides).toBeDefined();
    });
  });

  describe("5. Guide Catalog & Authoring & Progress", () => {
    it("POST /api/guides should create a guide with structured steps", async () => {
      const res = await request(app)
        .post("/api/guides")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          title: "ABA Bank QR Tutorial",
          description: "How to scan and pay with ABA Bank",
          category: "Banking",
          steps: [
            {
              stepNumber: 1,
              title: "Open ABA Mobile",
              instruction: "Tap the ABA app icon on your home screen.",
              targetElement: "aba-icon",
            },
            {
              stepNumber: 2,
              title: "Tap ABA PAY",
              instruction: "Press the QR Pay button at the bottom.",
              targetElement: "aba-pay-btn",
            },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe("ABA Bank QR Tutorial");
      createdGuideId = res.body.id;
    });

    it("GET /api/guides should list guides", async () => {
      const res = await request(app).get("/api/guides");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.guides)).toBe(true);
      expect(res.body.guides.length).toBeGreaterThan(0);
    });

    it("GET /api/guides/:id/progress should return totalSteps >= 1 for new unstarted guide", async () => {
      const res = await request(app)
        .get(`/api/guides/${createdGuideId}/progress`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.currentStep).toBe(1);
      expect(res.body.totalSteps).toBeGreaterThanOrEqual(1);
      expect(res.body.totalSteps).toBe(2);
      expect(res.body.completed).toBe(false);
    });

    it("POST /api/guides/:id/progress should sync user progress", async () => {
      const res = await request(app)
        .post(`/api/guides/${createdGuideId}/progress`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          currentStep: 2,
          totalSteps: 2,
          completed: true,
        });

      expect(res.status).toBe(200);
      expect(res.body.completed).toBe(true);
      expect(res.body.currentStep).toBe(2);
    });

    it("POST /api/user/progress should batch sync progress from extension", async () => {
      const res = await request(app)
        .post("/api/user/progress")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          batch: [
            { guideId: createdGuideId, stepIndex: 1, completedAt: new Date().toISOString() },
            { guideId: "custom_client_guide_1", stepIndex: 0, completedAt: new Date().toISOString() },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.syncedCount).toBe(2);
    });

    it("POST /api/user/progress with missing batch should return 400 validation error", async () => {
      const res = await request(app)
        .post("/api/user/progress")
        .set("Authorization", `Bearer ${authToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });
  });

  describe("6. AI Assistant & Auto-Step Generation", () => {
    it("POST /api/ai/generate-guide should generate steps from prompt", async () => {
      const res = await request(app)
        .post("/api/ai/generate-guide")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          prompt: "How to transfer with Wing Bank",
          category: "Banking",
          language: "km",
        });

      expect(res.status).toBe(200);
      expect(res.body.title).toBeDefined();
      expect(Array.isArray(res.body.steps)).toBe(true);
      expect(res.body.steps.length).toBeGreaterThan(0);
    });

    it("POST /api/ai/assistant-chat should provide contextual assistance", async () => {
      const res = await request(app)
        .post("/api/ai/assistant-chat")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          question: "Where is the QR button?",
          context: { guideTitle: "ABA Bank QR Tutorial", currentStep: 2 },
          language: "km",
        });

      expect(res.status).toBe(200);
      expect(res.body.answer).toBeDefined();
      expect(res.body.relatedTips).toBeDefined();
    });
  });

  describe("7. Billing & Community Endpoints", () => {
    it("GET /api/billing/current-plan should return current plan", async () => {
      const res = await request(app)
        .get("/api/billing/current-plan")
        .set("Authorization", `Bearer ${authToken}`);

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe("FREE");
    });

    it("GET /api/community/posts should return posts", async () => {
      const res = await request(app).get("/api/community/posts");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.posts)).toBe(true);
    });
  });
});
