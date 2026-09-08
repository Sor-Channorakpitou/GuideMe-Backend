import swaggerJsdoc from "swagger-jsdoc";
import { env } from "./env.js";

const isDev = env.NODE_ENV === "development";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "GuideMe API",
      version: "1.0.0",
      description: `REST API for GuideMe — a digital literacy assistant for Cambodia.

Base URL: \`/api\`

Authentication: Bearer JWT token in the \`Authorization\` header.`,
      contact: {
        name: "GuideMe Support",
        url: "/support",
      },
    },
    servers: [
      { url: env.API_URL, description: isDev ? "Development" : "Production" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string" },
                code: { type: "string" },
                details: { type: "array", items: { type: "object" } },
              },
            },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
            phone: { type: "string", nullable: true },
            avatar: { type: "string", nullable: true },
            language: { type: "string", enum: ["km", "en"] },
            plan: { type: "string", enum: ["FREE", "PRO", "ENTERPRISE"] },
            emailVerified: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            token: { type: "string" },
            user: { "$ref": "#/components/schemas/User" },
          },
        },
        Plan: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            price: { type: "number" },
            period: { type: "string" },
            description: { type: "string" },
            features: { type: "array", items: { type: "string" } },
          },
        },
        BillingPlan: {
          type: "object",
          properties: {
            plan: { type: "string", enum: ["FREE", "PRO", "ENTERPRISE"] },
            status: { type: "string", enum: ["ACTIVE", "CANCELED", "PAST_DUE", "EXPIRED"] },
            nextBillingDate: { type: "string", format: "date-time", nullable: true },
          },
        },
        BillingHistoryEntry: {
          type: "object",
          properties: {
            id: { type: "string" },
            plan: { type: "string" },
            amount: { type: "number" },
            status: { type: "string" },
            date: { type: "string", format: "date-time" },
            invoiceUrl: { type: "string", nullable: true },
          },
        },
        PaymentMethod: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string" },
            last4: { type: "string" },
            expMonth: { type: "integer" },
            expYear: { type: "integer" },
            isDefault: { type: "boolean" },
          },
        },
        NotificationSettings: {
          type: "object",
          properties: {
            email: { type: "boolean" },
            push: { type: "boolean" },
            newGuides: { type: "boolean" },
            updates: { type: "boolean" },
            tips: { type: "boolean" },
          },
        },
        AppSettings: {
          type: "object",
          properties: {
            overlayEnabled: { type: "boolean" },
            voiceEnabled: { type: "boolean" },
            readingSpeed: { type: "string", enum: ["slow", "normal", "fast"] },
          },
        },
        Stats: {
          type: "object",
          properties: {
            totalGuides: { type: "integer" },
            totalHours: { type: "number" },
            rating: { type: "number" },
          },
        },
        Activity: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string" },
            description: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Progress: {
          type: "object",
          properties: {
            guideName: { type: "string" },
            currentStep: { type: "integer" },
            totalSteps: { type: "integer" },
            percentage: { type: "number" },
          },
        },
        StepCompletion: {
          type: "object",
          properties: {
            guideId: { type: "string" },
            stepIndex: { type: "integer" },
            completedAt: { type: "string" },
          },
          required: ["guideId", "stepIndex"],
        },
        UpdateProgressPayload: {
          type: "object",
          properties: {
            batch: {
              type: "array",
              items: { "$ref": "#/components/schemas/StepCompletion" },
            },
          },
          required: ["batch"],
        },
        UserProfileResponse: {
          "$ref": "#/components/schemas/User",
        },
        GuideDetail: {
          "$ref": "#/components/schemas/Guide",
        },
        CommunityPost: {
          type: "object",
          properties: {
            id: { type: "string" },
            category: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            likes: { type: "integer" },
            commentsCount: { type: "integer" },
            author: { "$ref": "#/components/schemas/User" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        CommunityComment: {
          type: "object",
          properties: {
            id: { type: "string" },
            content: { type: "string" },
            author: { "$ref": "#/components/schemas/User" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Contributor: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            avatar: { type: "string", nullable: true },
            postCount: { type: "integer" },
            role: { type: "string" },
          },
        },
        SupportTicket: {
          type: "object",
          properties: {
            id: { type: "string" },
            category: { type: "string" },
            subject: { type: "string" },
            message: { type: "string" },
            status: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        GuideStep: {
          type: "object",
          properties: {
            stepNumber: { type: "integer" },
            title: { type: "string" },
            instruction: { type: "string" },
            hint: { type: "string" },
            targetElement: { type: "string" },
            screenshotUrl: { type: "string" },
            audioUrl: { type: "string" },
          },
        },
        Guide: {
          type: "object",
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            description: { type: "string" },
            category: { type: "string" },
            steps: { type: "array", items: { "$ref": "#/components/schemas/GuideStep" } },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        AIGenerateRequest: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string" },
            category: { type: "string" },
            language: { type: "string", enum: ["km", "en"] },
          },
        },
        TTSRequest: {
          type: "object",
          required: ["text"],
          properties: {
            text: { type: "string" },
            language: { type: "string", enum: ["km", "en"] },
            speed: { type: "string", enum: ["slow", "normal", "fast"] },
          },
        },
      },
    },
  },
  apis: ["./src/routes/*.ts"],
};

export const swaggerSpec = swaggerJsdoc(options);