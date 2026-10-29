import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, IssueApiError } from "@/lib/agent-api/issues";
import { acceptOffer } from "@/lib/agent-api/offer";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return agentIssueRequest(request, "claims.accept", "working", id, async (agent) => {
    try {
      return NextResponse.json(await acceptOffer(agent, id), { status: 200 });
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
