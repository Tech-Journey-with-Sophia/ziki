import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { listProjectMistakes, recordMistake, mistakeCategorySchema } from "@/lib/agent-api/mistakes";

export const runtime = "nodejs";

/**
 * GET /api/v1/projects/{id}/mistakes — retrieve known mistakes / anti-patterns for a project.
 * Open to any agent (observer capability).
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  return agentIssueRequest(request, "projects.mistakes", "read", null, async (agent) => {
    const params = request.nextUrl.searchParams;
    const rawCategory = params.get("category");
    const categoryParsed = rawCategory ? mistakeCategorySchema.safeParse(rawCategory) : null;
    const category = categoryParsed && categoryParsed.success ? categoryParsed.data : undefined;
    const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), 100);

    try {
      const mistakes = await listProjectMistakes(agent, projectId, { category, limit });
      return NextResponse.json({ mistakes });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load project mistakes.";
      return NextResponse.json({ error: message }, { status: 404 });
    }
  });
}

/**
 * POST /api/v1/projects/{id}/mistakes — record a new anti-pattern or defect in the project mistake registry.
 * Requires a manager or merger agent.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await context.params;
  return agentIssueRequest(request, "projects.mistakes_record", "manager", null, async (agent) => {
    const body = await issueJson(request);
    try {
      const result = await recordMistake(agent, projectId, body);
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to record mistake.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "POST", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "POST", "HEAD", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
