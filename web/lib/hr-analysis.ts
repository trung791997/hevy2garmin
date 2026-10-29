import { Decoder, Stream } from "@garmin/fitsdk";
import { firstFileFromZip, looksLikeZip, type HrPoint } from "hevy2garmin";

export interface HrMetadata {
  source: "watch_recording" | "daily_monitoring" | "backup" | "unknown";
  devices: string[];
  attribution: string;
  coveragePct: number;
  sampleCount: number;
  medianIntervalS: number | null;
  longestGapS: number;
  durationS: number;
  sourceActivityId?: string;
}
export interface HrRecording {
  points: HrPoint[];
  metadata: HrMetadata;
}

export function cleanPoints(raw: unknown, durationS = Infinity): HrPoint[] {
  if (!Array.isArray(raw)) return [];
  const byTime = new Map<number, number>();
  for (const p of raw) {
    const t = Number(p?.time),
      hr = Number(p?.hr);
    if (
      Number.isFinite(t) &&
      t >= 0 &&
      t <= durationS &&
      Number.isFinite(hr) &&
      hr > 0 &&
      hr < 256
    )
      byTime.set(t, Math.round(hr));
  }
  return [...byTime]
    .sort((a, b) => a[0] - b[0])
    .map(([time, hr]) => ({ time, hr }));
}

export function analyseHr(
  points: HrPoint[],
  durationS: number,
  source: HrMetadata["source"] = "unknown",
  devices: string[] = [],
): HrMetadata {
  const clean = cleanPoints(points, durationS);
  const intervals = clean
    .slice(1)
    .map((p, i) => p.time - clean[i].time)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const median = intervals.length
    ? intervals[Math.floor(intervals.length / 2)]
    : null;
  const halfWindow =
    Math.min(
      source === "daily_monitoring" ? 120 : 15,
      Math.max(1, median ?? 1),
    ) / 2;
  let covered = 0,
    end = 0,
    longestGap = 0;
  for (const p of clean) {
    const left = Math.max(0, p.time - halfWindow),
      right = Math.min(durationS, p.time + halfWindow);
    longestGap = Math.max(longestGap, left - end);
    covered += Math.max(0, right - Math.max(end, left));
    end = Math.max(end, right);
  }
  longestGap = Math.max(longestGap, durationS - end);
  return {
    source,
    devices,
    attribution: devices.length
      ? "External monitor detected in the recording metadata. Garmin may switch sensors during a session; individual readings are not source-tagged."
      : source === "watch_recording"
        ? "Watch recording; the file does not identify an external HR monitor."
        : source === "daily_monitoring"
          ? "Daily monitoring; external-monitor attribution is unavailable."
          : "The original sensor is not identified.",
    coveragePct:
      durationS > 0
        ? Math.min(100, Math.round((covered / durationS) * 100))
        : 0,
    sampleCount: clean.length,
    medianIntervalS: median,
    longestGapS: Math.round(longestGap),
    durationS,
  };
}

/** Device metadata is evidence of a connected sensor, not proof of every sample's origin. */
export function externalHrDevices(
  devices: Record<string, unknown>[],
): string[] {
  const detected: Array<{ label: string; index: unknown; identified: boolean }> = [];
  for (const d of devices) {
    const source = String(d.sourceType ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (
      ![
        "0",
        "1",
        "3",
        "ant",
        "antplus",
        "bluetooth",
        "bluetoothlowenergy",
      ].includes(source)
    )
      continue;
    const manufacturer = String(d.manufacturer ?? "").toLowerCase();
    const garmin = manufacturer === "garmin" || manufacturer === "1";
    // Garmin Connect identifies 4607 as HRM 600; the current FIT SDK leaves
    // this product numeric. CIRQA's product is present in the SDK profile.
    const product = Number(d.product ?? d.garminProduct);
    const model = garmin ? ({ 4607: "Garmin HRM 600", 5019: "Garmin CIRQA" } as Record<number, string>)[product] : undefined;
    const profileName = typeof d.garminProduct === "string" && !/^\d+$/.test(d.garminProduct) ? d.garminProduct : "";
    const name = String(d.productName || profileName || d.descriptor || "")
      .replace(/[^\p{L}\p{N}\s._-]/gu, "")
      .slice(0, 80);
    const kind = String(
      d.antplusDeviceType ?? d.bleDeviceType ?? d.deviceType ?? "",
    ).toLowerCase();
    const type = kind.replace(/[^a-z0-9]/g, "");
    const hrType =
      type === "heartrate" ||
      (type === "120" && ["0", "1", "ant", "antplus"].includes(source)) ||
      (type === "1" &&
        ["3", "bluetooth", "bluetoothlowenergy"].includes(source));
    if (!model && !/hrm|cirqa|heart.?rate/i.test(name) && !hrType) continue;
    const label = model ?? (/hrm.?600/i.test(name)
      ? "Garmin HRM 600"
      : /cirqa/i.test(name)
        ? "Garmin CIRQA"
        : name || "External HR monitor (model not identified)");
    detected.push({ label, index: d.deviceIndex, identified: !!(model || name) });
  }
  // A connection event may contain only a device index and HR type. Resolve
  // it against the named device-info entry rather than listing a second HRM.
  const knownIndices = new Set(detected.filter((d) => d.identified && d.index != null).map((d) => d.index));
  return [...new Set(detected.filter((d) => d.identified || d.index == null || !knownIndices.has(d.index)).map((d) => d.label))];
}

export function readHrRecording(
  bytes: Uint8Array,
  start: string,
  end: string,
  activityId?: string,
): HrRecording {
  const from = Date.parse(start),
    until = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(until) || until <= from)
    throw new Error("Workout times are invalid.");
  const fit = looksLikeZip(bytes) ? firstFileFromZip(bytes) : bytes;
  if (!fit) throw new Error("Activity file could not be opened.");
  const decoder = new Decoder(Stream.fromByteArray(Array.from(fit)));
  if (!decoder.isFIT() || !decoder.checkIntegrity())
    throw new Error("Activity file failed its integrity check.");
  const { messages, errors } = decoder.read();
  if (errors?.length)
    throw new Error("Activity file could not be fully decoded.");
  const points = cleanPoints(
    (messages.recordMesgs ?? []).map((r) => ({
      time: (new Date(r.timestamp as string | Date).getTime() - from) / 1000,
      hr: r.heartRate,
    })),
    (until - from) / 1000,
  );
  const metadata = analyseHr(
    points,
    (until - from) / 1000,
    "watch_recording",
    externalHrDevices(
      (messages.deviceInfoMesgs ?? []) as unknown as Record<string, unknown>[],
    ),
  );
  if (
    String(messages.fileIdMesgs?.[0]?.manufacturer).toLowerCase() ===
    "development"
  ) {
    metadata.source = "unknown";
    metadata.attribution =
      "Uploaded activity file; its original sensor is not identified by this file.";
  }
  if (activityId) metadata.sourceActivityId = activityId;
  return { points, metadata };
}
