import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  project: { findFirst: vi.fn() },
  agentMistake: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  agentAuditEvent: { create: vi.fn() },
  agentEvent: { create: vi.fn(), findUnique: vi.fn() },
  webhookSubscription: { findMany: vi.fn() },
  webhookDelivery: { createMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: db }));

import { recordMistake, listProjectMistakes } from "./mistakes";

const tenantId = "tenant-test";
const mergerAgent = { agentId: "m1", name: "Merger Agent", ownerId: "user-merger", tenantId, level: "manager" as const, burst: false, keyId: "k-m" };
const contributorAgent = { agentId: "c1", name: "Contributor Agent", ownerId: "user-contrib", tenantId, level: "working" as const, burst: false, keyId: "k-c" };
const observerAgent = { agentId: "o1", name: "Observer Agent", ownerId: "user-obs", tenantId, level: "working" as const, burst: false, keyId: "k-o" };

describe("lib/agent-api/mistakes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.project.findFirst.mockResolvedValue({ id: "proj-1" });
    db.agentEvent.create.mockResolvedValue({ id: "e1" });
    db.webhookSubscription.findMany.mockResolvedValue([]);
  });

  describe("recordMistake", () => {
    it("rejects non-merger agents", async () => {
      await expect(
        recordMistake(contributorAgent, "proj-1", {
          title: "Missing error handling",
          antiPattern: "Unhandled async promise rejection in fetch logic.",
          remediation: "Always wrap fetch calls in try/catch or use an error boundary.",
        }),
      ).rejects.toThrow("Only merger agents can record anti-patterns");
    });

    it("records a new mistake and publishes project.mistake_recorded", async () => {
      db.agentMistake.findFirst.mockResolvedValue(null);
      db.agentMistake.create.mockResolvedValue({
        id: "mistake-1",
        projectId: "proj-1",
        tenantId,
        mergerAgentId: "m1",
        bugId: "bug-42",
        category: "correctness",
        title: "Missing error handling",
        antiPattern: "Unhandled async promise rejection in fetch logic.",
        remediation: "Always wrap fetch calls in try/catch or use an error boundary.",
        badCodeSnippet: "const res = await fetch(url);",
        goodCodeSnippet: "try { const res = await fetch(url); } catch (e) { handle(e); }",
        recurrenceCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await recordMistake(mergerAgent, "proj-1", {
        category: "correctness",
        title: "Missing error handling",
        antiPattern: "Unhandled async promise rejection in fetch logic.",
        remediation: "Always wrap fetch calls in try/catch or use an error boundary.",
        badCodeSnippet: "const res = await fetch(url);",
        goodCodeSnippet: "try { const res = await fetch(url); } catch (e) { handle(e); }",
        bugId: "bug-42",
      });

      expect(result.ok).toBe(true);
      expect(result.mistake.id).toBe("mistake-1");
      expect(db.agentMistake.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          projectId: "proj-1",
          mergerAgentId: "m1",
          category: "correctness",
          title: "Missing error handling",
          bugId: "bug-42",
        }),
      });
      expect(db.agentAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: "project.mistake_recorded",
          target: "mistake:mistake-1",
        }),
      });
    });

    it("increments recurrence count when identical title exists in project", async () => {
      db.agentMistake.findFirst.mockResolvedValue({
        id: "mistake-existing",
        title: "Missing error handling",
        recurrenceCount: 2,
        badCodeSnippet: null,
        goodCodeSnippet: null,
        bugId: null,
      });
      db.agentMistake.update.mockResolvedValue({
        id: "mistake-existing",
        title: "Missing error handling",
        recurrenceCount: 3,
        antiPattern: "Updated antiPattern details.",
        remediation: "Updated remediation steps.",
      });

      const result = await recordMistake(mergerAgent, "proj-1", {
        title: "Missing error handling",
        antiPattern: "Updated antiPattern details.",
        remediation: "Updated remediation steps.",
      });

      expect(result.ok).toBe(true);
      expect(db.agentMistake.update).toHaveBeenCalledWith({
        where: { id: "mistake-existing" },
        data: expect.objectContaining({
          recurrenceCount: { increment: 1 },
          antiPattern: "Updated antiPattern details.",
          remediation: "Updated remediation steps.",
        }),
      });
      expect(db.agentMistake.create).not.toHaveBeenCalled();
    });
  });

  describe("listProjectMistakes", () => {
    it("allows observer level agents to query mistakes", async () => {
      const sampleList = [
        {
          id: "mistake-1",
          projectId: "proj-1",
          tenantId,
          mergerAgentId: "m1",
          category: "correctness",
          title: "Missing error handling",
          antiPattern: "Unhandled async promise rejection in fetch logic.",
          remediation: "Always wrap fetch calls in try/catch.",
          recurrenceCount: 3,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      db.agentMistake.findMany.mockResolvedValue(sampleList);

      const result = await listProjectMistakes(observerAgent, "proj-1", { category: "correctness", limit: 20 });
      expect(result).toEqual(sampleList);
      expect(db.agentMistake.findMany).toHaveBeenCalledWith({
        where: {
          tenantId,
          projectId: "proj-1",
          category: "correctness",
        },
        take: 20,
        orderBy: [{ recurrenceCount: "desc" }, { createdAt: "desc" }],
      });
    });
  });
});
