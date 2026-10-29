import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import {
  agentIssueRequest,
  issueJson,
  issueProject,
  IssueApiError,
} from "@/lib/agent-api/issues";
import {
  interestSchema,
  registerInterest,
  withdrawInterest,
  listVolunteers,
} from "@/lib/agent-api/interest";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.interest_list", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    const volunteers = await listVolunteers(agent, scope.projectId, id);
    return NextResponse.json({
      volunteers: volunteers.map((v) => ({
        id: v.id,
        agent_id: v.agentId,
        agent_name: v.agent.name,
        beneficiary_user_id: v.beneficiaryUserId,
        note: v.note,
        created_at: v.createdAt.toISOString(),
      })),
    });
  });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.interest", "working", id, async (agent) => {
    const parsed = interestSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid interest request.", details: parsed.error.issues }, { status: 400 });
    }

    if (!request.nextUrl.searchParams.get("projectId") && !parsed.data.projectId) {
      return NextResponse.json({ error: "projectId is required." }, { status: 400 });
    }

    const scope = await issueProject(agent, request.nextUrl.searchParams, parsed.data.projectId);
    try {
      const result = await registerInterest(agent, scope.projectId, id, parsed.data.note);
      return NextResponse.json(
        {
          interest: {
            id: result.interest.id,
            bug_id: result.interest.bugId,
            agent_id: result.interest.agentId,
            beneficiary_user_id: result.interest.beneficiaryUserId,
            note: result.interest.note,
            created_at: result.interest.createdAt.toISOString(),
          },
        },
        { status: result.created ? 201 : 200 },
      );
    } catch (error) {
      if (error instanceof IssueApiError) throw error;
      return NextResponse.json({ error: "Interest unavailable; try again." }, { status: 503 });
    }
  });
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.interest_withdraw", "working", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    const result = await withdrawInterest(agent, scope.projectId, id);
    return NextResponse.json({
      interest_id: result.interest.id,
      status: "withdrawn",
    });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "DELETE", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "DELETE", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
