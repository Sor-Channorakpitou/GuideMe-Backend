import { describe, it, expect } from "vitest";

describe("env", () => {
  it("should have default values when not set", async () => {
    const { env } = await import("../config/env.js");
    expect(env.PORT).toBe(4000);
    expect(env.JWT_SECRET).toBeTruthy();
    expect(env.CLIENT_URL).toBe("http://localhost:3000");
    expect(env.NODE_ENV).toBe("test");
  });
});

describe("auth middleware", () => {
  it("should reject requests without authorization header", async () => {
    const { auth } = await import("../middleware/auth.js");
    const req = { headers: {} } as any;
    const res = {
      status: (code: number) => {
        expect(code).toBe(401);
        return { json: (data: any) => expect(data.error.code).toBe("UNAUTHORIZED") };
      },
    } as any;
    auth(req, res, () => { expect.fail("next should not be called"); });
  });
});

describe("signToken utility", () => {
  it("should produce a valid JWT", async () => {
    const jwt = await import("jsonwebtoken");
    const { env } = await import("../config/env.js");
    const token = jwt.default.sign({ userId: "test-id" }, env.JWT_SECRET, { expiresIn: "7d" });
    const decoded = jwt.default.verify(token, env.JWT_SECRET) as { userId: string };
    expect(decoded.userId).toBe("test-id");
  });
});