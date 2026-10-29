import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, commentOnAgentIssue, listAgentIssueComments, issueProject } from "@/lib/agent-api/issues";

/** POST { body, parentId? }; projectId in query or body. Records the owner and agent. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "comments.create", "working", id,
    (agent) => commentOnAgentIssue(agent, request, id));
}

/** GET ?projectId=&after=&limit= — non-deleted comments, oldest first, { items, nextCursor } (#604).
 * `after` is the shared (createdAt, id) cursor and returns only newer comments;
 * the issue read keeps the latest 100, so a caller starts here and resumes by cursor.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "comments.list", "read", id, async (agent) => {
    const scope = await issueProject(agent, request.nextUrl.searchParams);
    return NextResponse.json(await listAgentIssueComments(scope, id, request.nextUrl.searchParams));
  });
}

const apiMethodNotAllowed = createMethodNotAllowed(["GET", "HEAD", "POST", "OPTIONS"]);
const apiOptions = createOptions(["GET", "HEAD", "POST", "OPTIONS"]);
export const PUT = apiMethodNotAllowed;
export const PATCH = apiMethodNotAllowed;
export const DELETE = apiMethodNotAllowed;
export const OPTIONS = apiOptions;
