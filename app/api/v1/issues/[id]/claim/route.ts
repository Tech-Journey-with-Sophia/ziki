import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject, IssueApiError } from "@/lib/agent-api/issues";
import { claimIssue, claimSchema } from "@/lib/agent-api/claim";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "claims.create", "working", id, async (agent) => {
    const parsed = claimSchema.safeParse(await issueJson(request));
    if (!parsed.success) return NextResponse.json({ error: "Invalid claim request." }, { status: 400 });
    if (!request.nextUrl.searchParams.get("projectId") && !parsed.data.projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    try {
      return NextResponse.json(await claimIssue(), { status: 201 });
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      return NextResponse.json({ error: "Claim unavailable; try again." }, { status: 503 });
    }
  }, { budget: "none" });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "OPTIONS"]);
const apiOptions = createOptions(["POST", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
