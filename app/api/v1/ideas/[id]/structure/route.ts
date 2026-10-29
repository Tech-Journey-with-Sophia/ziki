import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, IssueApiError } from "@/lib/agent-api/issues";
import { prisma } from "@/lib/prisma";
import { formatStructuredDescription, type IdeaStructureInput } from "@/lib/ideas";
import { audit } from "@/lib/agents/audit";

type Params = { id: string };

/**
 * POST /api/v1/ideas/:id/structure — refine an unstructured draft idea into
 * a standard structured specification, graduating it into the New ideas tab.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<Params> }) {
  const { id: bugId } = await params;
  return agentIssueRequest(request, "ideas.structure", "working", bugId, async (agent) => {
    const body = (await issueJson(request).catch(() => ({}))) as IdeaStructureInput & { title?: string };

    const bug = await prisma.bug.findUnique({
      where: { id: bugId },
      select: {
        id: true,
        number: true,
        title: true,
        description: true,
        status: true,
        tenantId: true,
        projectId: true,
        createdByAgentId: true,
      },
    });

    if (!bug || bug.tenantId !== agent.tenantId) {
      throw new IssueApiError(404, "Issue not found.");
    }
    if (bug.status !== "open") {
      throw new IssueApiError(400, "Only open draft ideas can be structured.");
    }

    const nextTitle = body.title?.trim() || bug.title;
    const nextDescription = formatStructuredDescription(bug.description, body);

    const updated = await prisma.$transaction(async (tx) => {
      await tx.bugRevision.create({
        data: {
          bugId: bug.id,
          title: bug.title,
          description: bug.description,
          editedById: agent.ownerId,
        },
      });

      const saved = await tx.bug.update({
        where: { id: bug.id },
        data: {
          title: nextTitle,
          description: nextDescription,
        },
        select: {
          id: true,
          number: true,
          title: true,
          description: true,
          status: true,
          updatedAt: true,
        },
      });

      await audit(
        agent,
        "idea.structured",
        `bug:${bug.id}`,
        { beforeTitle: bug.title, afterTitle: nextTitle },
        { db: tx },
      );

      return saved;
    });

    return NextResponse.json({ ok: true, issue: updated }, { status: 200 });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
