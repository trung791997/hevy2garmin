"use client";
import type { SyncPlan } from "@/lib/sync-plan";
export function SyncPlanDetails({
  plan,
  selected,
  onSelect,
  createNew,
  onCreateNew,
}: {
  plan: SyncPlan;
  selected: string;
  onSelect: (id: string) => void;
  createNew: boolean;
  onCreateNew: (value: boolean) => void;
}) {
  return (
    <div className="mt-4 space-y-3 text-sm">
      {plan.candidates.length > 0 && (
        <label className="block text-text-secondary">
          Watch recording
          <select
            aria-label="Watch recording"
            className="mt-1 w-full rounded-lg border border-border bg-base p-2"
            value={selected || plan.selectedId || ""}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">Choose a recording</option>
            {plan.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title} · {new Date(c.start).toLocaleString()} ·{" "}
                {c.overlapPct}% overlap · {c.driftMinutes} min apart
              </option>
            ))}
          </select>
        </label>
      )}
      {plan.changes.length > 0 && (
        <div>
          <strong>Will change</strong>
          <ul className="mt-1 list-disc pl-5 text-text-secondary">
            {plan.changes.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      )}
      {plan.preserves.length > 0 && (
        <div>
          <strong>Will keep</strong>
          <ul className="mt-1 list-disc pl-5 text-text-secondary">
            {plan.preserves.map((v) => (
              <li key={v}>{v}</li>
            ))}
          </ul>
        </div>
      )}
      {!plan.candidates.length && (
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={createNew}
            onChange={(e) => onCreateNew(e.target.checked)}
            className="mt-1 accent-teal"
          />
          <span>
            Create a separate activity if no watch recording is found. Preview
            again to review this choice.
          </span>
        </label>
      )}
    </div>
  );
}
