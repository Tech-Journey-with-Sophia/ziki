import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { coverTestMission, missionCoverageSchema } from "@/lib/missions";

const paramsSchema = z.object({ id: z.string().trim().min(1).max(191) });
const bodySchema = missionCoverageSchema.extend({ projectId: z.string().trim().min(1).max(191) }).strict();

/** POST JSON { projectId, issuesFiled } when the assigned route has been explored. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const rawParams = await context.params;
  return agentIssueRequest(request, "missions.covered", "working", `mission:${rawParams.id}`, async (agent) => {
    const params = paramsSchema.parse(rawParams);
    const body = bodySchema.parse(await issueJson(request));
    const scope = await issueProject(agent, request.nextUrl.searchParams, body.projectId);
    const covered = await coverTestMission(agent, scope.projectId, params.id, body.issuesFiled);
    if (!covered) {
      return NextResponse.json({ error: "mission_not_assigned", message: "This mission is not actively assigned to this agent." }, { status: 409 });
    }
    return NextResponse.json({ covered: true, issuesFiled: body.issuesFiled });
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
