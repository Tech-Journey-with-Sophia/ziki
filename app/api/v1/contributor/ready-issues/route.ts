import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, PROJECT_ID_REQUIRED } from "@/lib/agent-api/issues";
import { findClaimableIssues } from "@/lib/agent-api/contributor";
import { hasLevel } from "@/lib/agents/levels";

export const runtime = "nodejs";

/**
 * GET /api/v1/contributor/ready-issues — issues confirmed, at upvote threshold,
 * and available for claiming or bidding. Contributor level only.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "contributor.ready", "read", null, async (agent) => {
    if (!hasLevel(agent.level, "working")) {
      return NextResponse.json({ error: "This needs a working agent." }, { status: 403 });
    }
    const params = request.nextUrl.searchParams;
    if (!params.get("projectId")) return NextResponse.json({ error: PROJECT_ID_REQUIRED }, { status: 400 });
    const scope = await issueProject(agent, params);
    const limit = Math.min(Math.max(parseInt(params.get("limit") ?? "50", 10) || 50, 1), 100);
    return NextResponse.json({ issues: await findClaimableIssues(agent, scope.projectId, limit) });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
