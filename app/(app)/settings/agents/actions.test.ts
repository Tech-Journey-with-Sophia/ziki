import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.hoisted(() => vi.fn());
const setAgentBurst = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({ requireUser }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/agents/registry", () => ({
  createAgent: vi.fn(),
  regenerateKey: vi.fn(),
  revokeAgent: vi.fn(),
  setAgentAreaPreferences: vi.fn(),
  setAgentBurst,
  setAgentLevel: vi.fn(),
}));
vi.mock("@/lib/agents/rate-limit", () => ({ consumePairingLimit: vi.fn() }));
const approvePairing = vi.hoisted(() => vi.fn());
const findPendingPairing = vi.hoisted(() => vi.fn());
vi.mock("@/lib/agents/pairing", () => ({ approvePairing, findPendingPairing }));
vi.mock("@/lib/tenant-context", () => ({ currentTenantIdFor: vi.fn(async () => "tenant_1") }));
vi.mock("@/lib/feature-flags", () => ({ isAgentPlatformEnabled: () => true }));
vi.mock("@/lib/rate-limit", () => ({ RATE_LIMIT_MESSAGE: "Too fast." }));

import { pairAgentAction, setAgentBurstAction } from "./actions";

describe("setAgentBurstAction (#596)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "admin" });
    setAgentBurst.mockResolvedValue({ ok: true });
  });

  it("validates the agent and flag before loading the user", async () => {
    expect(await setAgentBurstAction(null, true)).toMatchObject({ ok: false });
    expect(await setAgentBurstAction("agent1", "yes")).toMatchObject({ ok: false });
    expect(requireUser).not.toHaveBeenCalled();
    expect(setAgentBurst).not.toHaveBeenCalled();
  });

  it("rejects a malformed or past expiry server-side", async () => {
    expect(await setAgentBurstAction("agent1", true, "not-a-date")).toMatchObject({
      ok: false,
      error: expect.stringContaining("Invalid"),
    });
    expect(await setAgentBurstAction("agent1", true, "2020-01-01T00:00:00.000Z")).toMatchObject({
      ok: false,
      error: expect.stringContaining("future"),
    });
    expect(setAgentBurst).not.toHaveBeenCalled();
  });

  it("passes an unexpired timestamp through and revalidates", async () => {
    const until = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    expect(await setAgentBurstAction("agent1", true, until)).toEqual({ ok: true });
    expect(setAgentBurst).toHaveBeenCalledWith({ id: "admin" }, "agent1", true, new Date(until));
    expect(revalidatePath).toHaveBeenCalledWith("/agents");
  });

  it("passes no expiry when the grant is disabled", async () => {
    expect(await setAgentBurstAction("agent1", false)).toEqual({ ok: true });
    expect(setAgentBurst).toHaveBeenCalledWith({ id: "admin" }, "agent1", false, null);
  });

  it("does not revalidate when the caller is not an admin", async () => {
    setAgentBurst.mockResolvedValue({ ok: false, error: "Only an admin can change an agent's read budget." });
    expect(await setAgentBurstAction("agent1", true)).toMatchObject({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not report success when persistence fails", async () => {
    setAgentBurst.mockResolvedValue({ ok: false, error: "Couldn't change the read budget. Try again." });
    expect(await setAgentBurstAction("agent1", true)).toMatchObject({ ok: false });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("pairAgentAction instructions (#431)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ id: "ada" });
  });

  it("shows the agent's proposed instructions on the confirm step", async () => {
    findPendingPairing.mockResolvedValue({
      id: "p1",
      proposedName: "Ada's Claude",
      proposedModel: "Claude",
      proposedLevel: "working",
      proposedInstructions: "Focus on desktop bugs.",
      expiresAt: new Date(),
    });
    const form = new FormData();
    form.set("code", "ABCD-2345");
    expect(await pairAgentAction(undefined, form)).toMatchObject({
      ok: true,
      step: "confirm",
      instructions: "Focus on desktop bugs.",
    });
  });

  it("passes the owner's approved text to approvePairing", async () => {
    approvePairing.mockResolvedValue({ ok: true, name: "Ada's Claude" });
    const form = new FormData();
    form.set("code", "ABCD-2345");
    form.set("intent", "approve");
    form.set("projectId", "project_1");
    form.set("instructions", "Owner-edited brief.");
    expect(await pairAgentAction(undefined, form)).toEqual({ ok: true, step: "done", name: "Ada's Claude" });
    expect(approvePairing).toHaveBeenCalledWith(
      { id: "ada" },
      "ABCD-2345",
      expect.any(Date),
      "project_1",
      "tenant_1",
      "Owner-edited brief.",
    );
  });
});
