import { createMethodNotAllowed, createOptions } from "@/lib/agent-api/http-errors";
import { NextResponse, type NextRequest } from "next/server";
import { agentIssueRequest, issueJson, issueProject } from "@/lib/agent-api/issues";
import { nextMissionSchema, nextTestMission } from "@/lib/missions";

/** POST JSON { projectId } to receive the least-recently-covered mission. */
export async function POST(request: NextRequest) {
  return agentIssueRequest(request, "missions.next", "working", null, async (agent) => {
    const body = nextMissionSchema.parse(await issueJson(request));
    const scope = await issueProject(agent, request.nextUrl.searchParams, body.projectId);
    const mission = await nextTestMission(agent, scope.projectId);
    if (!mission) {
      return NextResponse.json({ error: "no_missions_available", message: "This project has no available test missions." }, { status: 409 });
    }
    return NextResponse.json({
      id: mission.id,
      projectId: mission.projectId,
      projectName: mission.project.name,
      stagingUrl: mission.project.stagingUrl,
      routePattern: mission.routePattern,
      brief: mission.brief,
      role: mission.role,
      viewport: mission.viewport,
      leaseExpiresAt: mission.leaseExpiresAt,
    });
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
