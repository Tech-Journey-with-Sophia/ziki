import { beforeEach, describe, expect, it, vi } from "vitest";

const requireUser = vi.hoisted(() => vi.fn());
const createAgent = vi.hoisted(() => vi.fn());
const isAgentPlatformEnabled = vi.hoisted(() => vi.fn());
const revalidatePath = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/auth-helpers", () => ({ requireUser }));
vi.mock("@/lib/agents/registry", () => ({ createAgent }));
vi.mock("@/lib/feature-flags", () => ({ isAgentPlatformEnabled }));
vi.mock("@/lib/site-url", () => ({ getSiteUrl: () => "https://ziki.dev" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: { findUnique: vi.fn() },
    agentApiKey: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { checkAgentConnectedAction, startAgentConnectAction } from "./actions";

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "user_1" });
  isAgentPlatformEnabled.mockReturnValue(true);
  vi.mocked(prisma.project.findUnique).mockResolvedValue({ name: "Alpha" } as never);
});

describe("startAgentConnectAction", () => {
  it("registers the named agent and returns setup text carrying its key", async () => {
    createAgent.mockResolvedValue({
      ok: true,
      key: { agentId: "agent_1", name: "Claude", level: "working", rawKey: "zk_secret", prefix: "zk_sec" },
    });

    const result = await startAgentConnectAction({ name: "Claude", projectId: "proj_1" });

    expect(createAgent).toHaveBeenCalledWith({ id: "user_1" }, { name: "Claude", projectId: "proj_1" });
    expect(result).toMatchObject({ ok: true, agentId: "agent_1", name: "Claude" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.setupText).toContain("zk_secret");
    expect(result.setupText).toContain("https://ziki.dev/api/v1/agents/me");
    expect(result.setupText).toContain("Alpha");
    expect(revalidatePath).toHaveBeenCalledWith("/agents");
  });

  it("passes the registry's error back", async () => {
    createAgent.mockResolvedValue({ ok: false, error: "Choose a project in this workspace." });
    expect(await startAgentConnectAction({ name: "Claude", projectId: "nope" })).toEqual({
      ok: false,
      error: "Choose a project in this workspace.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("issues nothing when the agent platform is off", async () => {
    isAgentPlatformEnabled.mockReturnValue(false);
    expect(await startAgentConnectAction({ name: "Claude", projectId: "proj_1" })).toMatchObject({ ok: false });
    expect(createAgent).not.toHaveBeenCalled();
  });
});

describe("checkAgentConnectedAction", () => {
  it("is not connected until the agent's key has been used", async () => {
    vi.mocked(prisma.agentApiKey.findFirst).mockResolvedValue(null);
    expect(await checkAgentConnectedAction("agent_1")).toEqual({ connected: false });
  });

  it("is connected once the key has been used, and only asks about the owner's own agent", async () => {
    vi.mocked(prisma.agentApiKey.findFirst).mockResolvedValue({ id: "key_1" } as never);
    expect(await checkAgentConnectedAction("agent_1")).toEqual({ connected: true });
    expect(vi.mocked(prisma.agentApiKey.findFirst).mock.calls[0][0]).toMatchObject({
      where: { agent: { id: "agent_1", ownerUserId: "user_1", revokedAt: null }, lastUsedAt: { not: null } },
    });
  });
});
