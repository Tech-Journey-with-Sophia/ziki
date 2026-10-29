import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson } from "@/lib/agent-api/issues";
import { agentQuestionSchema, askAgentQuestion } from "@/lib/agent-questions";

export const runtime = "nodejs";

/**
 * POST /api/v1/questions — a contributor or above asks its owner something (#446).
 * Body: `{ "body": "…", "bugId": "…" }` (bugId optional).
 */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "questions.ask", "working", null, async (agent) => {
    const parsed = agentQuestionSchema.safeParse(await issueJson(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid question.", details: parsed.error.issues }, { status: 400 });
    }
    return NextResponse.json({ question: await askAgentQuestion(agent, parsed.data) }, { status: 201 });
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
