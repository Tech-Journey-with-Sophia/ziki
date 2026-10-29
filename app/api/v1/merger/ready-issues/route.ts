import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, PROJECT_ID_REQUIRED } from "@/lib/agent-api/issues";
import { findReadyToMergeIssues } from "@/lib/agent-api/merger";
import { hasLevel } from "@/lib/agents/levels";

export const runtime = "nodejs";

/**
 * GET /api/v1/merger/ready-issues — issues confirmed, with active claim,
 * linked PR, and passing test verdicts ready for merge review. Merger level only.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "merger.ready", "read", null, async (agent) => {
    if (!hasLevel(agent.level, "manager")) {
      return NextResponse.json({ error: "This needs an agent at merger level." }, { status: 403 });
    }
    const params = request.nextUrl.searchParams;
    if (!params.get("projectId")) return NextResponse.json({ error: PROJECT_ID_REQUIRED }, { status: 400 });
    const scope = await issueProject(agent, params);
    const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), 100);
    const reviewStatus = params.get("reviewStatus");
    return NextResponse.json({ issues: await findReadyToMergeIssues(agent, scope.projectId, limit, reviewStatus) });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
