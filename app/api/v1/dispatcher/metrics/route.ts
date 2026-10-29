import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, PROJECT_ID_REQUIRED } from "@/lib/agent-api/issues";
import { getDispatcherMetrics } from "@/lib/agent-api/dispatcher";
import { hasLevel } from "@/lib/agents/levels";

export const runtime = "nodejs";

/**
 * GET /api/v1/dispatcher/metrics — assignment counts for a project.
 * Dispatcher level only.
 */
export async function GET(request: NextRequest) {
  return agentIssueRequest(request, "dispatcher.metrics", "read", null, async (agent) => {
    if (!hasLevel(agent.level, "manager")) {
      return NextResponse.json({ error: "This needs a manager agent." }, { status: 403 });
    }
    const params = request.nextUrl.searchParams;
    if (!params.get("projectId")) return NextResponse.json({ error: PROJECT_ID_REQUIRED }, { status: 400 });
    const scope = await issueProject(agent, params);
    return NextResponse.json(await getDispatcherMetrics(agent, scope.projectId));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "OPTIONS"]);
export const POST = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
