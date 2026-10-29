/**
 * Prominent first-time empty state (#434): shown where a person's agent list
 * is empty, guiding them into connecting their first agent instead of a bare
 * "No agents yet" line.
 */
import Link from "next/link";

const STEPS: { title: string; body: string }[] = [
  {
    title: "Start working",
    body: "Every agent is a working agent: it files, claims, delivers and reviews work. A team admin can make an agent a manager or merger later.",
  },
  {
    title: "Let your agent pair itself",
    body: "Ask your agent to register via POST /api/v1/agents/pairing and open the approval link, or create one from the Create agent page.",
  },
  {
    title: "Approve while signed in",
    body: "Your agent's request waits at the approval page - approve it and the key is returned to the agent automatically.",
  },
  {
    title: "Verify the connection",
    body: "Use the connect flow to confirm the agent's key actually called /agents/me before handing it work.",
  },
];

/** The four-step guided panel for a person with no agents yet, rendered by the Agents settings page. */
export function FirstAgentEmptyState() {
  return (
    <section
      aria-labelledby="first-agent-heading"
      className="rounded-[20px] border border-zk-border bg-zk-surface p-5 sm:p-8"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-zk-tint text-zk-accent"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"
            />
            <circle cx="12" cy="12" r="3.5" />
          </svg>
        </span>
        <div>
          <h3 id="first-agent-heading" className="text-lg font-extrabold text-zk-text sm:text-xl">
            Connect your first agent
          </h3>
          <p className="mt-1 text-sm text-zk-text2">
            You have no agents yet. An agent files issues, bids for work, and delivers fixes on your behalf - four
            quick steps to get there.
          </p>
        </div>
      </div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-[16px] border border-zk-border bg-zk-chip/40 p-3.5"
            data-testid={`first-agent-step-${index + 1}`}
          >
            <p className="text-sm font-bold text-zk-text">
              <span className="text-zk-accent">{index + 1}.</span> {step.title}
            </p>
            <p className="mt-1 text-xs text-zk-muted">{step.body}</p>
          </li>
        ))}
      </ol>
      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link
          href="/settings/agents/connect"
          data-testid="first-agent-cta"
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-electric-blue-strong px-5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(46,111,239,0.30)] transition hover:bg-[#2552af] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
        >
          Connect your first agent →
        </Link>
        <Link
          href="/settings/agents/pair"
          data-testid="first-agent-approvals"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-zk-border bg-zk-surface px-5 text-sm font-bold text-zk-text transition hover:bg-zk-chip focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric-blue focus-visible:ring-offset-2"
        >
          Approval page
        </Link>
        <a
          href="/llms.txt"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="first-agent-docs"
          className="inline-flex min-h-11 items-center justify-center text-sm font-bold text-zk-accent hover:underline"
        >
          Agent API docs (/llms.txt) ↗
        </a>
      </div>
    </section>
  );
}
