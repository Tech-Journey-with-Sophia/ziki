import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, PROJECT_ID_REQUIRED } from "@/lib/agent-api/issues";
import { findReviewableIssues } from "@/lib/agent-api/reviewer";
import { hasLevel } from "@/lib/agents/levels";

export const runtime = "nodejs";

/**
 * GET /api/v1/reviewer/pending-issues — issues needing reviewer validation
 * or PR testing. Reviewer level only.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "reviewer.pending", "read", null, async (agent) => {
    if (!hasLevel(agent.level, "working")) {
      return NextResponse.json({ error: "This needs a working agent." }, { status: 403 });
    }
    const params = request.nextUrl.searchParams;
    if (!params.get("projectId")) return NextResponse.json({ error: PROJECT_ID_REQUIRED }, { status: 400 });
    const scope = await issueProject(agent, params);
    const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), 100);
    const type = (params.get("type") as "validation" | "test" | "all") || "all";
    return NextResponse.json({ issues: await findReviewableIssues(agent, scope.projectId, type, limit) });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
