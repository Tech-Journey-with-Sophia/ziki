import { ThemeSettings } from "@/components/theme-settings";
import { parseTheme } from "@/lib/theme";
import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { currentTenantIdFor } from "@/lib/tenant-context";
import { NotificationSettings } from "@/components/notification-settings";
import { DisplayNameForm } from "@/components/display-name-form";
import { WalletAddressForm } from "@/components/wallet-address-form";
import { KeyboardShortcutSettings } from "@/components/keyboard-shortcut-settings";
import { isAgentPlatformEnabled } from "@/lib/feature-flags";
import { ChangePasswordForm } from "@/components/change-password-form";
import { AccountDataSettings } from "@/components/account-data-settings";

/* Distinct browser-tab title; the root layout appends "· Ziki". */
export const metadata = { title: "Settings" };

type SearchParams = Promise<{
  tab?: string | string[];
}>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function SettingsPage(props: {
  searchParams?: SearchParams;
}): Promise<React.JSX.Element>;
export default async function SettingsPage(): Promise<React.JSX.Element>;
export default async function SettingsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
} = {}): Promise<React.JSX.Element> {
  const user = await requireUser();
  const params = searchParams ? await searchParams : {};
  const activeTab = (one(params.tab) ?? "all").toLowerCase();

  let settings: {
    name?: string | null;
    email?: string | null;
    theme?: string | null;
    walletAddress?: string | null;
    emailNotifications?: boolean;
    notifyMentions?: boolean;
    notifyAssignments?: boolean;
    notifyStatusChanges?: boolean;
    keyboardShortcuts?: boolean;
    passwordHash?: string | null;
  } | null = null;

  try {
    settings = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        name: true,
        email: true,
        theme: true,
        walletAddress: true,
        emailNotifications: true,
        notifyMentions: true,
        notifyAssignments: true,
        notifyStatusChanges: true,
        keyboardShortcuts: true,
        passwordHash: true,
      },
    });
  } catch (error) {
    console.error("[settings] full settings query failed, falling back to minimal fields:", error);
    try {
      settings = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          name: true,
          email: true,
        },
      });
    } catch (fallbackError) {
      console.error("[settings] fallback user query failed:", fallbackError);
      settings = {
        name: user.name ?? null,
        email: user.email ?? null,
      };
    }
  }

  let tenant: { id: string; name: string; slug: string; description?: string | null } | null = null;
  let tenantId: string | null = null;
  try {
    if (prisma?.membership && prisma?.tenant) {
      tenantId = await currentTenantIdFor(user.id);
      if (tenantId) {
        tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true, slug: true, description: true },
        });
      }
    }
  } catch (tenantError) {
    console.error("[settings] tenant query failed:", tenantError);
  }

  const showPersonal = activeTab === "all" || activeTab === "personal" || activeTab === "account";
  const showOrg = activeTab === "all" || activeTab === "organization" || activeTab === "org";

  const scopeTitle =
    activeTab === "personal" || activeTab === "account"
      ? "Personal Account Settings"
      : activeTab === "organization" || activeTab === "org"
        ? `Organization Settings · ${tenant?.name ?? "Workspace"}`
        : "Settings";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Scope Breadcrumbs and Header */}
      <div className="space-y-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm text-slate-500">
          <Link href="/issues" className="text-teal-700 hover:underline">
            ← Back to issues
          </Link>
          <span className="text-slate-300">/</span>
          <Link href="/settings" className="text-slate-600 hover:underline">
            Settings
          </Link>
          {activeTab === "personal" || activeTab === "account" ? (
            <>
              <span className="text-slate-300">/</span>
              <span className="font-medium text-slate-900">Personal Account</span>
            </>
          ) : activeTab === "organization" || activeTab === "org" ? (
            <>
              <span className="text-slate-300">/</span>
              <span className="font-medium text-slate-900">Organization ({tenant?.name ?? "Workspace"})</span>
            </>
          ) : null}
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{scopeTitle}</h1>
            <p className="mt-0.5 text-sm text-slate-600">
              Manage personal identity and preferences, or configure shared organization assets and team agents.
            </p>
          </div>
          {tenant && (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 shadow-sm">
              <span className="h-2 w-2 rounded-full bg-teal-500" />
              <span>Active Org:</span>
              <span className="font-semibold text-slate-900">{tenant.name}</span>
            </div>
          )}
        </div>
      </div>

      {/* Scope Navigation Tabs */}
      <nav aria-label="Settings section tabs" className="flex items-center gap-2 border-b border-slate-200 pb-3">
        <Link
          href="/settings"
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            activeTab === "all"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          All Settings
        </Link>
        <Link
          href="/settings?tab=personal"
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            activeTab === "personal" || activeTab === "account"
              ? "bg-teal-700 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <span>👤</span>
          <span>Personal Account</span>
        </Link>
        <Link
          href="/settings?tab=organization"
          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            activeTab === "organization" || activeTab === "org"
              ? "bg-purple-700 text-white"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <span>🏢</span>
          <span>Organization &amp; Workspace</span>
        </Link>
      </nav>

      {/* 1. PERSONAL / ACCOUNT SETTINGS */}
      {showPersonal && (
        <section className="space-y-4" aria-labelledby="personal-settings-heading">
          <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">👤</span>
                <h2 id="personal-settings-heading" className="text-sm font-bold uppercase tracking-wide text-teal-900">
                  Personal Account Settings
                </h2>
              </div>
              <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-semibold text-teal-800">
                Personal Scope
              </span>
            </div>
            <p className="mt-1 text-xs text-teal-800">
              Changes in this section apply exclusively to your individual profile, private authentication, and personal notification preferences.
            </p>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Profile
              </h3>
              <span className="text-[11px] font-medium text-slate-600">Personal</span>
            </div>
            <DisplayNameForm initialName={settings?.name ?? user.name ?? ""} />
            <p className="mt-3 text-sm">
              <Link href={`/users/${user.id}`} className="text-teal-700 hover:underline">
                See how your profile looks to others
              </Link>
            </p>
          </section>

          {settings?.passwordHash ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Password
                </h3>
                <span className="text-[11px] font-medium text-slate-600">Personal</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">Changing your password signs out all active sessions.</p>
              <ChangePasswordForm />
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Wallet
              </h3>
              <span className="text-[11px] font-medium text-slate-600">Personal</span>
            </div>
            <WalletAddressForm initialAddress={settings?.walletAddress ?? ""} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Security &amp; 2FA
              </h3>
              <span className="text-[11px] font-medium text-slate-600">Personal</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Protect your personal account with a second step at sign-in.
            </p>
            <p className="mt-3 text-sm">
              <Link href="/settings/security" className="font-medium text-teal-700 hover:underline">
                Two-factor sign-in →
              </Link>
            </p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Appearance
              </h3>
              <span className="text-[11px] font-medium text-slate-600">Personal</span>
            </div>
            <ThemeSettings initialTheme={parseTheme(settings?.theme)} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Email notifications
              </h3>
              <span className="text-[11px] font-medium text-slate-600">Personal</span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Sent to <span className="font-medium text-slate-800">{settings?.email}</span>.
              You&apos;re never emailed about your own changes.
            </p>
            <NotificationSettings
              initialEnabled={settings?.emailNotifications ?? true}
              initialPrefs={{
                notifyMentions: settings?.notifyMentions ?? true,
                notifyAssignments: settings?.notifyAssignments ?? true,
                notifyStatusChanges: settings?.notifyStatusChanges ?? true,
              }}
            />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Keyboard shortcuts
              </h3>
              <span className="text-[11px] font-medium text-slate-600">Personal</span>
            </div>
            <KeyboardShortcutSettings initialEnabled={settings?.keyboardShortcuts ?? true} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Account data &amp; deletion
              </h3>
              <span className="text-[11px] font-medium text-slate-600">Personal</span>
            </div>
            <AccountDataSettings />
          </section>
        </section>
      )}

      {/* 2. ORGANISATION / WORKSPACE SETTINGS */}
      {showOrg && (
        <section className="space-y-4 pt-2" aria-labelledby="org-settings-heading">
          <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🏢</span>
                <h2 id="org-settings-heading" className="text-sm font-bold uppercase tracking-wide text-purple-900">
                  Organisation &amp; Workspace Settings
                </h2>
              </div>
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">
                Organization Scope: {tenant?.name ?? "Shared Workspace"}
              </span>
            </div>
            <p className="mt-1 text-xs text-purple-800">
              Settings here impact all members, automated agents, platforms, and integrations in this organization.
            </p>
          </div>

          {/* Active Organization Card */}
          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Active Organization
                </h3>
                <p className="mt-1 text-lg font-bold text-slate-900">{tenant?.name ?? "Ziki Workspace"}</p>
                {tenant?.slug && (
                  <p className="text-xs text-slate-500">Slug: @{tenant.slug}</p>
                )}
                {tenant?.description && (
                  <p className="mt-2 text-sm text-slate-600">{tenant.description}</p>
                )}
              </div>
              <Link
                href="/tenants"
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Switch Organization ↗
              </Link>
            </div>
          </section>

          {isAgentPlatformEnabled() ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Workspace Agents
                </h3>
                <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                  Org Scope
                </span>
              </div>
              <p className="mt-2 text-sm text-slate-600">
                Register AI agents that work issues for this organization, pair autonomous workers, and inspect team audit logs.
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <Link href="/settings/agents/connect" className="font-medium text-teal-700 hover:underline">
                  Connect your agent
                </Link>
                <Link href="/settings/agents" className="font-medium text-teal-700 hover:underline">
                  Manage agents
                </Link>
                <Link href="/settings/webhooks" className="font-medium text-teal-700 hover:underline">
                  Webhooks
                </Link>
                <Link href="/settings/agents/pair" className="font-medium text-teal-700 hover:underline">
                  Pair an agent
                </Link>
                <Link href="/settings/audit" className="font-medium text-teal-700 hover:underline">
                  Agent audit log
                </Link>
                <Link href="/docs" className="font-medium text-teal-700 hover:underline">
                  API Docs &amp; /llms.txt
                </Link>
              </div>
            </section>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Members &amp; Administration
              </h3>
              <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                Org Scope
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Manage member roles, invites, and administrative privileges for this organization.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <Link href="/team" className="font-medium text-teal-700 hover:underline">
                Team Directory
              </Link>
              <Link href="/admin" className="font-medium text-teal-700 hover:underline">
                Admin Console
              </Link>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                API &amp; Integrations
              </h3>
              <span className="rounded bg-purple-100 px-2 py-0.5 text-[10px] font-semibold text-purple-700">
                Org Scope
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-600">
              Developer documentation, cURL references, and machine-readable specifications for AI agents and automated tools.
            </p>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <Link href="/docs" className="font-medium text-teal-700 hover:underline">
                API Documentation
              </Link>
              <a
                href="/llms.txt"
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-teal-700 hover:underline"
              >
                AI Specs (/llms.txt) ↗
              </a>
            </div>
          </section>
        </section>
      )}
    </div>
  );
}
