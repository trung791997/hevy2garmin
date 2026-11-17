"use client";
import { useEffect, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import type { HrMetadata } from "@/lib/hr-analysis";

interface Point {
  time: number;
  hr: number;
}
export interface HrTimelineData {
  points?: Point[] | null;
  samples?: number[] | null;
  metadata?: HrMetadata | null;
  cached_at?: string | null;
  backupAvailable?: boolean;
  syncState?: { message?: string; status?: string } | null;
}
export function HrTimeline({
  hevyId,
  initialData,
}: {
  hevyId: string;
  initialData?: HrTimelineData;
}) {
  const [data, setData] = useState<HrTimelineData | null>(initialData ?? null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [hover, setHover] = useState<Point | null>(null);
  const url = withBasePath(`/api/workout/${encodeURIComponent(hevyId)}/hr`);
  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("HR could not be loaded.");
        return r.json();
      })
      .then(setData)
      .catch((error) => {
        if (!controller.signal.aborted) setMessage(error.message);
      });
    return () => controller.abort();
  }, [url, initialData]);
  async function refresh() {
    setBusy(true);
    setMessage("");
    try {
      const r = await fetch(url, { method: "POST" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error ?? "HR refresh failed.");
      setMessage(body.message);
      const latest = await fetch(url);
      if (!latest.ok) throw new Error("Updated HR could not be loaded.");
      setData(await latest.json());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "HR refresh failed.");
    } finally {
      setBusy(false);
    }
  }
  const points = (data?.points ?? [])
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.hr))
    .toSorted((a, b) => a.time - b.time);
  const rates = points.length ? points.map((p) => p.hr) : (data?.samples ?? []);
  const min = rates.reduce((v, n) => Math.min(v, n), Infinity),
    max = rates.reduce((v, n) => Math.max(v, n), -Infinity);
  const avg = rates.length
    ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length)
    : null;
  const duration = data?.metadata?.durationS || points.at(-1)?.time || 1;
  const gap = Math.max(
    10,
    Math.min(180, (data?.metadata?.medianIntervalS ?? 10) * 3),
  );
  const segments: Point[][] = [];
  for (const p of points) {
    if (!segments.length || p.time - segments.at(-1)!.at(-1)!.time > gap)
      segments.push([]);
    segments.at(-1)!.push(p);
  }
  const time = (seconds: number) =>
    `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
  const selected = hover ?? points[0];
  const m = data?.metadata;
  return (
    <section
      className="mt-4 rounded-xl border border-border bg-surface p-4"
      aria-label="Heart-rate recording"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text">Heart rate</h3>
          <p className="mt-1 text-xs text-text-secondary">
            {m?.source === "watch_recording"
              ? "Watch activity recording"
              : m?.source === "daily_monitoring"
                ? "Daily monitoring · sparse readings"
                : rates.length
                  ? "Saved HR · source not identified"
                  : "HR recording pending"}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={refresh}
          className="min-h-11 rounded-lg border border-border px-3 text-xs text-text disabled:opacity-50"
        >
          {busy ? "Refreshing…" : "Refresh HR & note"}
        </button>
      </div>
      {m && (
        <div className="mt-3 space-y-1 text-xs text-text-secondary">
          <p>
            {m.devices.length
              ? `External monitor detected: ${m.devices.join(", ")}`
              : "External monitor not identified"}
          </p>
          <p>
            Approximately {m.coveragePct}% coverage ·{" "}
            {m.sampleCount.toLocaleString()} readings · longest gap{" "}
            {time(m.longestGapS)}
          </p>
          <p>{m.attribution}</p>
        </div>
      )}
      {points.length > 0 ? (
        <div className="mt-4">
          <svg
            role="img"
            aria-label="Heart rate over elapsed workout time. Gaps indicate missing readings."
            viewBox="0 0 600 130"
            className="h-32 w-full"
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const t =
                Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) *
                duration;
              setHover(
                points.reduce((a, b) =>
                  Math.abs(a.time - t) < Math.abs(b.time - t) ? a : b,
                ),
              );
            }}
          >
            {segments.map((part, i) =>
              part.length === 1 ? (
                <circle
                  key={i}
                  cx={8 + (part[0].time / duration) * 584}
                  cy={115 - ((part[0].hr - min) / Math.max(1, max - min)) * 100}
                  r="2.5"
                  fill="#ff8555"
                />
              ) : (
                <polyline
                  key={i}
                  points={part
                    .map(
                      (p) =>
                        `${8 + (p.time / duration) * 584},${115 - ((p.hr - min) / Math.max(1, max - min)) * 100}`,
                    )
                    .join(" ")}
                  fill="none"
                  stroke="#ff8555"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              ),
            )}
          </svg>
          <div className="flex justify-between text-xs text-text-muted">
            <span>0:00</span>
            <span>{time(duration)} elapsed</span>
          </div>
          {selected && (
            <label className="mt-3 block text-xs text-text-secondary">
              Inspect reading: {time(selected.time)} · {selected.hr} bpm
              <input
                aria-label="Inspect HR reading"
                type="range"
                min={0}
                max={Math.max(0, points.length - 1)}
                value={Math.max(
                  0,
                  points.findIndex((p) => p === selected),
                )}
                onChange={(e) => setHover(points[Number(e.target.value)])}
                className="mt-2 block w-full accent-teal"
              />
            </label>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-text-muted">
          {rates.length
            ? "This older cache has no timestamps. Refresh HR to draw an accurate timeline."
            : "No cached heart-rate for this workout yet."}
        </p>
      )}
      {rates.length > 0 && (
        <div className="mt-3 flex justify-between text-xs tabular-nums text-text-muted">
          <span>min {min} bpm</span>
          <span>avg {avg} bpm</span>
          <span>max {max} bpm</span>
        </div>
      )}
      <p className="mt-3 text-xs text-text-muted">
        Refresh reads the saved Garmin activity and updates the managed Hevy HR
        note when enabled. It never uploads or replaces a Garmin activity.
      </p>
      {data?.cached_at && (
        <p className="mt-1 text-xs text-text-muted">
          Fetched {new Date(data.cached_at).toLocaleString()}
        </p>
      )}
      {data?.syncState?.status === "review" && (
        <p className="mt-2 text-xs text-warm">{data.syncState.message}</p>
      )}
      {data?.backupAvailable && (
        <a
          className="mt-3 inline-block text-xs text-teal underline"
          href={withBasePath(
            `/api/workout/${encodeURIComponent(hevyId)}/backup`,
          )}
        >
          Download original Garmin recording
        </a>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs text-text-secondary">
          {message}
        </p>
      )}
    </section>
  );
}
