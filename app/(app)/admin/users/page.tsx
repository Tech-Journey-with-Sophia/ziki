import Link from "next/link";
import { Suspense } from "react";
import type { AgentLevel } from "@prisma/client";
import { requireSuperAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { tenantMemberWhere } from "@/lib/membership-admin";
import { MEMBERSHIP_ROLE_LABELS } from "@/lib/tenants";
import { currentTenantAccess } from "@/lib/tenant-access";
import { toSingleQueryParam } from "@/lib/search";
import { LocalTime } from "@/components/local-time";
import { Avatar } from "@/components/avatar";
import { Badge } from "@/components/ui/badge";
import { MemberRoleActions } from "@/components/member-role-actions";
import { SiteRoleActions } from "@/components/site-role-actions";
import { TeamAgentLevelControl } from "@/components/team-agent-level";
import { UserSearch } from "@/components/user-search";
import { PaginationControls } from "@/components/pagination-controls";
import { calculatePagination } from "@/lib/pagination";
import { settableLevels } from "@/lib/agents/levels";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Admins" };

const roleBadgeClass = {
  member: "bg-zk-chip text-zk-text2",
  admin: "bg-zk-tint text-zk-accent",
  owner: "bg-zk-warn-bg text-zk-warn-fg",
} as const;

/**
 * People in the organization you're working in, ordered owner → admin →
 * member. MembershipRole is declared in that order, and Postgres sorts enums
 * by declaration, so `role: "asc"` is that order.
 */
const USERS_PER_PAGE = 25;

type SearchParams = Promise<{
  q?: string | string[];
  page?: string | string[];
  [key: string]: string | string[] | undefined;
}>;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const actor = await requireSuperAdmin();
  const access = await currentTenantAccess(actor.id, actor.role);

  const params = searchParams ? await searchParams : {};
  const query = toSingleQueryParam(params.q)?.trim() ?? "";

  const tenantId = access.tenantId;
  const tenantName = access.tenantName;
  const tenantSlug = access.tenantSlug;
  if (!tenantId || !tenantName || !tenantSlug) {
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-semibold text-zk-text sm:text-2xl">Admin management</h1>
        <p className="max-w-xl text-sm text-zk-text2">
          Open an organization first. Roles on this page belong to one organization,
          not to every account on the site.
        </p>
        <Link href="/tenants" className="text-sm font-medium text-zk-accent hover:underline">
          Choose an organization
        </Link>
      </div>
    );
  }

  const where = tenantMemberWhere(tenantId, query);
  const totalCount = await prisma.membership.count({ where });
  const pagination = calculatePagination({
    page: params.page,
    pageSize: USERS_PER_PAGE,
    totalCount,
  });

  const [members, ownerCount] = await Promise.all([
    prisma.membership.findMany({
      where,
      orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
      skip: pagination.skip,
      take: pagination.take,
      select: {
        role: true,
        createdAt: true,
        user: {
          select: { id: true, name: true, email: true, image: true, role: true },
        },
      },
    }),
    prisma.membership.count({ where: { tenantId, role: "owner" } }),
  ]);

  const memberIds = members.map((member) => member.user.id);
  const agents = memberIds.length
    ? await prisma.agent.findMany({
        where: { tenantId, ownerUserId: { in: memberIds }, revokedAt: null },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: { id: true, name: true, level: true, ownerUserId: true },
      })
    : [];
  const agentsByOwner = new Map<string, typeof agents>();
  for (const agent of agents) {
    const list = agentsByOwner.get(agent.ownerUserId) ?? [];
    list.push(agent);
    agentsByOwner.set(agent.ownerUserId, list);
  }
  const agentLevels = settableLevels({ isOwner: false, isTenantAdmin: true });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zk-text sm:text-2xl">Admin management</h1>
          <p className="mt-1 max-w-2xl text-sm text-zk-text2">
            People in <span className="font-medium text-zk-text">{tenantName}</span>.
            Organization role is for this workspace only. Site role (including super admin)
            applies across the platform. Both are people’s roles. Agents have their own class
            (working, manager or merger), which you can set per agent; it never changes a person’s role.
          </p>
          <p className="mt-2 text-sm">
            <Link
              href={`/tenants/${tenantSlug}`}
              className="font-medium text-zk-accent hover:underline"
            >
              Invites for {tenantName}
            </Link>
            <span className="text-zk-muted"> · </span>
            <Link href="/tenants" className="font-medium text-zk-accent hover:underline">
              Switch organization
            </Link>
            <span className="text-zk-muted"> · </span>
            <Link href="/admin/rewards" className="font-medium text-zk-accent hover:underline">
              Platform points
            </Link>
          </p>
        </div>
        <div className="w-full sm:w-auto">
          <Suspense
            fallback={<div className="h-9 w-full animate-pulse rounded-lg bg-slate-100 sm:w-64" />}
          >
            <UserSearch />
          </Suspense>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[20px] border border-zk-border bg-zk-surface">
        {members.length > 0 ? (
          <table className="min-w-full divide-y divide-zk-border text-sm">
            <thead className="bg-zk-tint text-left text-xs font-semibold uppercase tracking-wide text-zk-muted">
              <tr>
                <th className="whitespace-nowrap px-4 py-3">User</th>
                <th className="whitespace-nowrap px-4 py-3">Org role</th>
                <th className="whitespace-nowrap px-4 py-3">Site role &amp; agents</th>
                <th className="whitespace-nowrap px-4 py-3">Joined</th>
                <th className="whitespace-nowrap px-4 py-3 text-right">Org actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zk-divider">
              {members.map((member) => (
                <tr key={member.user.id} className="hover:bg-zk-tint/80">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={member.user.name} image={member.user.image} size="md" />
                      <div className="min-w-0">
                        <div className="font-medium text-zk-text">{member.user.name}</div>
                        <div className="break-all text-xs text-zk-muted sm:text-sm">{member.user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge className={roleBadgeClass[member.role]}>
                      {MEMBERSHIP_ROLE_LABELS[member.role]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col items-start gap-2">
                      <SiteRoleActions
                        userId={member.user.id}
                        userName={member.user.name}
                        siteRole={member.user.role}
                        disabled={member.user.id === actor.id || member.user.role === "super_admin"}
                      />
                      {(agentsByOwner.get(member.user.id) ?? []).length > 0 ? (
                        <ul className="space-y-1.5 text-left">
                          {(agentsByOwner.get(member.user.id) ?? []).map((agent) => (
                            <li key={agent.id} className="flex flex-wrap items-center gap-2">
                              <span className="text-xs font-medium text-zk-text2">{agent.name}</span>
                              <TeamAgentLevelControl
                                agentId={agent.id}
                                agentName={agent.name}
                                level={agent.level as AgentLevel}
                                levels={agentLevels}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-zk-muted">No agents</p>
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-zk-text2">
                    <LocalTime date={member.createdAt} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <MemberRoleActions
                      tenantId={tenantId}
                      tenantName={tenantName}
                      userId={member.user.id}
                      userName={member.user.name}
                      membershipRole={member.role}
                      siteSuperAdmin={member.user.role === "super_admin"}
                      canChangeRoles
                      canRemove
                      isSelf={member.user.id === actor.id}
                      ownerCount={ownerCount}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : query ? (
          <div className="px-4 py-12 text-center">
            <p className="font-medium text-zk-text">
              No one in {tenantName} matching &ldquo;{query}&rdquo;
            </p>
            <p className="mt-1 text-sm text-zk-muted">
              This search only looks at people who have joined {tenantName}.
            </p>
            <Link
              href="/admin/users"
              className="mt-3 inline-flex text-sm font-medium text-zk-accent hover:underline"
            >
              Clear search
            </Link>
          </div>
        ) : (
          <p className="px-4 py-8 text-center text-sm text-zk-muted">
            No one has joined {tenantName} yet.
          </p>
        )}
      </div>

      <PaginationControls
        page={pagination.page}
        totalPages={pagination.totalPages}
        totalCount={pagination.totalCount}
        from={pagination.from}
        to={pagination.to}
        queryParams={{ q: query || undefined }}
        basePath="/admin/users"
        itemLabel="user"
      />
    </div>
  );
}
