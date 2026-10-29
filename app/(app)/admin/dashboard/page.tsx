import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { paginatedTenantLeaderboard } from "@/lib/points/leaderboard";
import { Avatar } from "@/components/avatar";
import { fetchDashboard, type Breakdown } from "@/lib/dashboard-queries";
import {
  RANGE_PRESETS,
  formatDateParam,
  isPreset,
  parseDateRange,
  presetRange,
} from "@/lib/dashboard-range";
import { severityLabel, statusLabel } from "@/lib/labels";

export const metadata: Metadata = { title: "Dashboard" };

type SearchParams = Promise<{
  from?: string | string[];
  to?: string | string[];
}>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const user = await requireAdmin();

  const params = searchParams ? await searchParams : {};
  const range = parseDateRange({ from: one(params.from), to: one(params.to) });
  const data = await fetchDashboard(range);

  const tenantId = await currentTenantIdFor(user.id);
  const { entries: leaderboardRows } = tenantId
    ? await paginatedTenantLeaderboard(prisma, tenantId, { page: 1, limit: 5 })
    : { entries: [] };

  const contributorIds = leaderboardRows.map((e) => e.userId);
  const agentOwners =
    contributorIds.length > 0 && tenantId
      ? await prisma.agent.findMany({
          where: { tenantId, ownerUserId: { in: contributorIds }, revokedAt: null },
          select: { ownerUserId: true },
        })
      : [];
  const agentOwnerIds = new Set(agentOwners.map((a) => a.ownerUserId));

  const statusTotal = data.byStatus.reduce((sum, s) => sum + s.count, 0);
  const inProgressCount = data.byStatus
    .filter((s) => s.status === "in_progress" || s.status === "assigned" || s.status === "started")
    .reduce((sum, s) => sum + s.count, 0);
  const openBacklog = Math.max(0, statusTotal - data.totalClosed);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin" className="text-sm text-teal-700 hover:underline">
          ← Back to admin
        </Link>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-600">
          Activity and issue velocity between{" "}
          <span className="font-medium text-slate-800">
            {formatDateParam(range.from)}
          </span>{" "}
          and{" "}
          <span className="font-medium text-slate-800">
            {formatDateParam(new Date(range.to.getTime() - 86400000))}
          </span>
        </p>
      </div>

      <RangePicker range={range} />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Opened" value={String(data.totalOpened)} />
        <Stat label="Closed" value={String(data.totalClosed)} />
        <Stat label="In Progress" value={String(inProgressCount)} />
        <Stat label="Open Backlog" value={String(openBacklog)} />
      </dl>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Top Contributors
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Ranked by solved tasks and reward points
              </p>
            </div>
            <Link
              href="/leaderboard"
              className="text-xs font-medium text-teal-700 hover:underline"
            >
              View all →
            </Link>
          </div>

          {leaderboardRows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No contributions yet in this workspace. Resolve an issue to appear on the leaderboard.
            </p>
          ) : (
            <ol className="mt-4 divide-y divide-slate-100">
              {leaderboardRows.map((entry) => {
                const isAgent = agentOwnerIds.has(entry.userId);
                return (
                  <li
                    key={entry.userId}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <span className="w-6 text-right text-xs font-semibold tabular-nums text-slate-500">
                      #{entry.rank}
                    </span>
                    <Avatar name={entry.name} image={entry.image} />
                    <div className="min-w-0 flex-1 truncate">
                      <Link
                        href={`/users/${entry.userId}`}
                        className="truncate text-sm font-medium text-slate-900 hover:underline"
                      >
                        {entry.name}
                      </Link>
                      <div className="mt-0.5">
                        <span
                          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            isAgent
                              ? "bg-purple-100 text-purple-700"
                              : "bg-teal-100 text-teal-700"
                          }`}
                        >
                          {isAgent ? "Agent" : "Contributor"}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs tabular-nums text-slate-600">
                      {entry.solvedTasks} solved
                    </span>
                    <span className="w-16 text-right text-sm font-semibold tabular-nums text-slate-900">
                      {entry.points} pts
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <div className="grid gap-4 sm:grid-cols-2 lg:col-span-3 lg:grid-cols-2">
          <BreakdownCard
            title="By status"
            rows={data.byStatus.map((s) => ({
              label: statusLabel[s.status as keyof typeof statusLabel] ?? s.status,
              count: s.count,
            }))}
            total={statusTotal}
          />
          <BreakdownCard
            title="By severity"
            rows={data.bySeverity.map((s) => ({
              label:
                severityLabel[s.label as keyof typeof severityLabel] ?? s.label,
              count: s.count,
            }))}
            total={statusTotal}
          />
          <div className="sm:col-span-2">
            <BreakdownCard title="By platform" rows={data.byPlatform} total={statusTotal} />
          </div>
        </div>
      </div>
    </div>
  );
}

function RangePicker({ range }: { range: ReturnType<typeof parseDateRange> }) {
  return (
    <nav aria-label="Date range" className="flex flex-wrap items-center gap-2">
      {RANGE_PRESETS.map((preset) => {
        const target = presetRange(preset.days);
        const active = isPreset(range, preset.days);
        return (
          <Link
            key={preset.days}
            href={`/admin/dashboard?from=${formatDateParam(target.from)}&to=${formatDateParam(
              new Date(target.to.getTime() - 86400000),
            )}`}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              active
                ? "border-teal-700 bg-teal-700 text-white"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {preset.label}
          </Link>
        );
      })}
      <form
        action="/admin/dashboard"
        className="flex flex-wrap items-end gap-2 sm:ml-2"
      >
        <label className="text-xs font-medium text-slate-600">
          <span className="mb-1 block">From</span>
          <input
            type="date"
            name="from"
            defaultValue={formatDateParam(range.from)}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          <span className="mb-1 block">To</span>
          <input
            type="date"
            name="to"
            defaultValue={formatDateParam(new Date(range.to.getTime() - 86400000))}
            className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900"
          />
        </label>
        <button
          type="submit"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Apply
        </button>
      </form>
    </nav>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
        {value}
        {hint ? (
          <span className="mt-1 block text-xs font-normal normal-case tracking-normal text-slate-500">
            {hint}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
  total,
  wide = false,
}: {
  title: string;
  rows: Breakdown[];
  total: number;
  wide?: boolean;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">Nothing in this range.</p>
      ) : (
        <table className={`mt-3 w-full text-sm ${wide ? "max-w-2xl" : ""}`}>
          <caption className="sr-only">{title}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Group</th>
              <th scope="col">Issues</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="py-1 pr-3 text-left font-normal text-slate-700">
                  {row.label}
                </th>
                <td className="w-full py-1 pr-3">
                  <span
                    aria-hidden="true"
                    className="block h-2 rounded-sm bg-teal-600/70"
                    style={{
                      width: `${total > 0 ? Math.max(2, (row.count / total) * 100) : 0}%`,
                    }}
                  />
                </td>
                <td className="py-1 text-right tabular-nums text-slate-900">
                  {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
