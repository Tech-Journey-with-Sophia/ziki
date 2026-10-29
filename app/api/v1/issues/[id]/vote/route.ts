import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueProject, IssueApiError } from "@/lib/agent-api/issues";
import { removeUpvote, upvoteIssue, voteSchema } from "@/lib/agent-api/votes";

async function scopeFor(agent: Parameters<typeof issueProject>[0], request: NextRequest) {
  const text = await request.text();
  let bodyProjectId: string | undefined;
  if (text.trim()) {
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new IssueApiError(400, "Send a valid JSON body.");
    }
    const parsed = voteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid vote request.", details: parsed.error.issues }, { status: 400 });
    }
    bodyProjectId = parsed.data.projectId;
  }
  return issueProject(agent, request.nextUrl.searchParams, bodyProjectId);
}

/**
 * POST records the agent's owner as an upvote: one, or MANAGER_VOTE_WEIGHT from
 * a manager or merger agent on someone else's report. Repeating it does not add
 * another.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.vote", "working", id, async (agent) => {
    const scope = await scopeFor(agent, request);
    if (scope instanceof NextResponse) return scope;
    const result = await upvoteIssue(agent, scope.projectId, id);
    return NextResponse.json(
      { voted: result.voted, voteCount: result.voteCount, changed: result.changed, weight: result.weight, userId: agent.ownerId },
      { status: result.changed ? 201 : 200 },
    );
  });
}

/** DELETE removes that owner's upvote. */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "issues.vote_remove", "working", id, async (agent) => {
    const scope = await scopeFor(agent, request);
    if (scope instanceof NextResponse) return scope;
    const result = await removeUpvote(agent, scope.projectId, id);
    return NextResponse.json({
      voted: result.voted,
      voteCount: result.voteCount,
      changed: result.changed,
      userId: agent.ownerId,
    });
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["POST", "DELETE", "OPTIONS"]);
const apiOptions = createOptions(["POST", "DELETE", "OPTIONS"]);
export const GET = apiMethodNotAllowed;
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const HEAD = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
