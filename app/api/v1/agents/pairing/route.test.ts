import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const startPairing = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/rate-limit", () => ({ consumePairingLimit: vi.fn(async () => null) }));
vi.mock("@/lib/agents/pairing", () => ({
  PAIRING_POLL_INTERVAL: 5,
  pairingApprovalPath: (code: string) => `/settings/agents/pair?code=${encodeURIComponent(code)}`,
  startPairing,
}));
vi.mock("@/lib/site-url", () => ({ absoluteUrl: (path: string) => `https://ziki.dev${path}` }));

import { POST } from "./route";

describe("POST /api/v1/agents/pairing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a link the signed-in owner can approve", async () => {
    startPairing.mockResolvedValue({
      ok: true,
      userCode: "KX7P-2MQD",
      deviceCode: "device-secret",
      expiresAt: new Date("2026-10-20T12:15:00.000Z"),
    });
    const response = await POST(
      new NextRequest("https://ziki.dev/api/v1/agents/pairing", {
        method: "POST",
        body: JSON.stringify({ name: "Claude", model: "Claude" }),
      }),
    );
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      user_code: "KX7P-2MQD",
      device_code: "device-secret",
      verification_uri: "https://ziki.dev/settings/agents/pair",
      verification_uri_complete: "https://ziki.dev/settings/agents/pair?code=KX7P-2MQD",
      interval: 5,
      message: expect.stringContaining("If you can open a browser, also open verification_uri_complete"),
    });
    expect(startPairing).toHaveBeenCalledWith({ name: "Claude", model: "Claude", level: undefined });
  });

  it("passes the requested level through (#425)", async () => {
    startPairing.mockResolvedValue({ ok: true, userCode: "KX7P-2MQD", deviceCode: "d", expiresAt: new Date() });
    await POST(
      new NextRequest("https://ziki.dev/api/v1/agents/pairing", {
        method: "POST",
        body: JSON.stringify({ name: "Claude", level: "manager" }),
      }),
    );
    expect(startPairing).toHaveBeenCalledWith({ name: "Claude", model: undefined, level: "manager" });
  });

  it("passes proposed instructions through (#431)", async () => {
    startPairing.mockResolvedValue({ ok: true, userCode: "KX7P-2MQD", deviceCode: "d", expiresAt: new Date() });
    await POST(
      new NextRequest("https://ziki.dev/api/v1/agents/pairing", {
        method: "POST",
        body: JSON.stringify({ name: "Claude", instructions: "Focus on desktop bugs." }),
      }),
    );
    expect(startPairing).toHaveBeenCalledWith(expect.objectContaining({ instructions: "Focus on desktop bugs." }));
  });

  it("answers 400 when the proposed instructions are rejected (#431)", async () => {
    startPairing.mockResolvedValue({ ok: false, error: "Instructions must be 4000 characters or fewer." });
    const response = await POST(
      new NextRequest("https://ziki.dev/api/v1/agents/pairing", {
        method: "POST",
        body: JSON.stringify({ name: "Claude", instructions: "x".repeat(4001) }),
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request", message: expect.stringContaining("4000") });
  });
});
