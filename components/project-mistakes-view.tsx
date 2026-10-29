"use client";

import { useState } from "react";
import type { MistakeCategory } from "@prisma/client";

export type ProjectMistakeItem = {
  id: string;
  projectId: string;
  bugId?: string | null;
  category: MistakeCategory;
  title: string;
  antiPattern: string;
  remediation: string;
  badCodeSnippet?: string | null;
  goodCodeSnippet?: string | null;
  recurrenceCount: number;
  mergerAgent?: { id: string; name: string } | null;
  createdAt: Date | string;
};

const CATEGORIES: { label: string; value: MistakeCategory | "all" }[] = [
  { label: "All Categories", value: "all" },
  { label: "Correctness", value: "correctness" },
  { label: "Efficiency", value: "efficiency" },
  { label: "Completeness", value: "completeness" },
  { label: "Mergeability", value: "mergeability" },
  { label: "Architecture", value: "architecture" },
  { label: "Security", value: "security" },
];

const categoryBadgeClass: Record<MistakeCategory, string> = {
  correctness: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  efficiency: "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  completeness: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  mergeability: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  architecture: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  security: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
};

export function ProjectMistakesView({
  mistakes = [],
}: {
  mistakes: ProjectMistakeItem[];
}) {
  const [selectedCategory, setSelectedCategory] = useState<MistakeCategory | "all">("all");

  const filtered = selectedCategory === "all"
    ? mistakes
    : mistakes.filter((m) => m.category === selectedCategory);

  return (
    <div className="flex flex-col gap-6" data-testid="project-mistakes-view">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-bold text-zk-text">Agent Mistake Registry</h2>
        <p className="text-sm text-zk-muted">
          Living anti-patterns and remediation guidelines logged by manager agents during code integration to prevent repeated errors.
        </p>
      </div>

      {/* Category Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zk-border pb-3">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            type="button"
            onClick={() => setSelectedCategory(cat.value)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
              selectedCategory === cat.value
                ? "bg-zk-accent text-white"
                : "bg-zk-chip text-zk-text2 hover:bg-zk-border"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Mistakes List */}
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zk-border p-8 text-center text-sm text-zk-muted">
          No anti-patterns recorded yet in this category.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="flex flex-col gap-3 rounded-2xl border border-zk-border bg-zk-surface p-5 shadow-sm"
              data-testid="mistake-item"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wider ${
                      categoryBadgeClass[item.category]
                    }`}
                  >
                    {item.category}
                  </span>
                  <h3 className="text-base font-bold text-zk-text">{item.title}</h3>
                </div>
                {item.recurrenceCount > 1 && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                    Repeated {item.recurrenceCount}x
                  </span>
                )}
              </div>

              {/* Anti-Pattern & Remediation text */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1 rounded-xl border border-red-200/60 bg-red-50/40 p-3 text-xs dark:border-red-900/40 dark:bg-red-950/20">
                  <span className="font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
                    Anti-Pattern (Avoid)
                  </span>
                  <p className="text-zk-text leading-relaxed">{item.antiPattern}</p>
                </div>
                <div className="flex flex-col gap-1 rounded-xl border border-emerald-200/60 bg-emerald-50/40 p-3 text-xs dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <span className="font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Remediation (Recommended)
                  </span>
                  <p className="text-zk-text leading-relaxed">{item.remediation}</p>
                </div>
              </div>

              {/* Code Snippets (if any) */}
              {(item.badCodeSnippet || item.goodCodeSnippet) && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {item.badCodeSnippet && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-mono font-bold text-red-500">Problematic Code:</span>
                      <pre className="max-h-36 overflow-x-auto rounded-lg border border-red-200 bg-slate-950 p-2.5 font-mono text-[11px] leading-relaxed text-red-300 dark:border-red-900/50">
                        <code>{item.badCodeSnippet}</code>
                      </pre>
                    </div>
                  )}
                  {item.goodCodeSnippet && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11px] font-mono font-bold text-emerald-500">Corrected Code:</span>
                      <pre className="max-h-36 overflow-x-auto rounded-lg border border-emerald-200 bg-slate-950 p-2.5 font-mono text-[11px] leading-relaxed text-emerald-300 dark:border-emerald-900/50">
                        <code>{item.goodCodeSnippet}</code>
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
