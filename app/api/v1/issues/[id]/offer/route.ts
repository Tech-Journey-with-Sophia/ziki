import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject, IssueApiError } from "@/lib/agent-api/issues";
import { offerIssue, offerSchema } from "@/lib/agent-api/offer";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "claims.offer", "working", id, async (agent) => {
    const parsed = offerSchema.safeParse(await issueJson(request));
    if (!parsed.success) return NextResponse.json({ error: "Invalid offer request." }, { status: 400 });
    if (!request.nextUrl.searchParams.get("projectId") && !parsed.data.projectId) return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    try {
      return NextResponse.json({ offer: await offerIssue(agent, scope.projectId, id) }, { status: 201 });
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      return NextResponse.json({ error: "Offer unavailable; try again." }, { status: 503 });
    }
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
