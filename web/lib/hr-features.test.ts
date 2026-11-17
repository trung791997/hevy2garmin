import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Encoder, Profile } from "@garmin/fitsdk";
import {
  generateFit,
  syncOneWorkout,
  type GarminGateway,
  type SyncDeps,
} from "hevy2garmin";
import { analyseHr, externalHrDevices, readHrRecording } from "./hr-analysis";
import { planSync } from "./sync-plan";
import { DEFAULT_SYNC_SETTINGS } from "./sync-settings";
import { protectReplacements, saveOriginalBackup } from "./replacement-guard";
import { runEnhancedSync } from "./enhanced-sync";
import type { Sql } from "./pending-store";

const start = "2026-10-27T10:00:00Z",
  end = "2026-10-27T11:00:00Z";
const workout = {
  id: "workout-1",
  title: "Legs",
  start_time: start,
  end_time: end,
  exercises: [
    {
      title: "Squat (Barbell)",
      sets: [{ type: "normal", reps: 5, weight_kg: 50 }],
    },
  ],
};
const watch = {
  activityId: 101,
  activityName: "Strength",
  manufacturer: "GARMIN",
  startTimeGMT: start,
  duration: 3600,
  activityType: { typeKey: "strength_training" },
};
const points = Array.from({ length: 3601 }, (_, time) => ({
  time,
  hr: 100 + (time % 60),
}));
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());
function sensorFit(name = "HRM 600", sourceType = "antplus") {
  const encoder = new Encoder();
  const write = (value: Record<string, unknown>) =>
    encoder.writeMesg(value as never);
  write({
    mesgNum: Profile.MesgNum.FILE_ID,
    type: "activity",
    manufacturer: "garmin",
    timeCreated: new Date(start),
  });
  write({
    mesgNum: Profile.MesgNum.DEVICE_INFO,
    deviceIndex: 1,
    manufacturer: "garmin",
    productName: name,
    sourceType,
    deviceType: 120,
    timestamp: new Date(start),
  });
  for (const point of points)
    write({
      mesgNum: Profile.MesgNum.RECORD,
      timestamp: new Date(Date.parse(start) + point.time * 1000),
      heartRate: point.hr,
    });
  return new Uint8Array(encoder.close());
}
function database() {
  const values = new Map<string, unknown>();
  const writes: string[] = [];
  const sql = (async (strings: TemplateStringsArray, ...args: unknown[]) => {
    const query = strings.join("?");
    if (query.includes("INSERT INTO app_cache")) {
      writes.push(query);
      values.set(String(args[0]), args[1]);
      return [];
    }
    if (query.includes("SELECT value FROM app_cache"))
      return values.has(String(args[0]))
        ? [{ value: values.get(String(args[0])) }]
        : [];
    if (query.includes("INSERT INTO hr_cache")) {
      writes.push(query);
      values.set("hr:" + args[0], args[1]);
      return [];
    }
    if (query.includes("SELECT data FROM hr_cache"))
      return values.has("hr:" + args[0])
        ? [{ data: values.get("hr:" + args[0]) }]
        : [];
    return [];
  }) as unknown as Sql;
  sql.json = (v: unknown) => v;
  return { sql, values, writes };
}
function gateway(bytes: Uint8Array = sensorFit()): GarminGateway {
  return {
    activitiesByDate: vi.fn(async () => [watch]),
    activity: vi.fn(async () => watch),
    activityFit: vi.fn(async () => bytes),
    exerciseSets: vi.fn(async () => ({
      exerciseSets: [{ setType: "ACTIVE", exercises: [{ category: "SQUAT" }] }],
    })),
    putExerciseSets: vi.fn(async () => {}),
    deleteActivity: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    describe: vi.fn(async () => {}),
    upload: vi.fn(
      async () =>
        ({ success: true, activityId: 202, status: "success" }) as never,
    ),
    findExistingActivity: vi.fn(async () => null),
    dailyHeartRate: vi.fn(
      async (): Promise<Array<[number, number | null]>> => [
        [Date.parse(start), 40],
      ],
    ),
  };
}
function deps(g: GarminGateway): SyncDeps {
  return {
    gateway: async () => g,
    fetchWorkouts: async () => [workout],
    store: {
      loadSyncedIds: async () => new Set(),
      loadPendingIds: async () => new Set(),
      isSynced: async () => false,
      markSynced: vi.fn(async () => {}),
      claimPending: vi.fn(async () => true),
    } as unknown as SyncDeps["store"],
  };
}

describe("external HR recordings", () => {
  it.each(["HRM 600", "CIRQA"])(
    "decodes real timestamped FIT records and detects %s",
    (name) => {
      const recording = readHrRecording(sensorFit(name), start, end, "101");
      expect(recording.points).toEqual(points);
      expect(recording.metadata.devices).toEqual(["Garmin " + name]);
      expect(recording.metadata.coveragePct).toBe(100);
      expect(recording.metadata.attribution).toContain("not source-tagged");
    },
  );
  it("does not label the recording device or a BLE GPS device as an external HRM", () => {
    expect(
      externalHrDevices([
        { productName: "CIRQA", sourceType: "local", deviceType: "heartRate" },
        { sourceType: "bluetoothLowEnergy", deviceType: 0 },
      ]),
    ).toEqual([]);
    expect(
      externalHrDevices([{ sourceType: "bluetoothLowEnergy", deviceType: 1 }]),
    ).toEqual(["External HR monitor (model not identified)"]);
  });
  it("reports both monitors when metadata cannot identify which supplied each sample", () => {
    expect(
      externalHrDevices([
        { productName: "CIRQA", sourceType: "antplus" },
        { productName: "HRM 600", sourceType: "bluetoothLowEnergy" },
      ]),
    ).toEqual(["Garmin CIRQA", "Garmin HRM 600"]);
  });
  it("resolves HRM 600's numeric product and its repeated connection event to one monitor", () => {
    expect(externalHrDevices([
      { manufacturer: "garmin", product: 4607, garminProduct: 4607, sourceType: "bluetoothLowEnergy", bleDeviceType: "heartRate", deviceIndex: 2 },
      { manufacturer: "garmin", product: 4607, sourceType: "bluetoothLowEnergy", bleDeviceType: "heartRate", deviceIndex: 3 },
      { sourceType: "antplus", antplusDeviceType: "heartRate", deviceIndex: 2 },
    ])).toEqual(["Garmin HRM 600"]);
  });
  it("does not use Garmin's product IDs for other manufacturers or hide a distinct unknown monitor", () => {
    expect(externalHrDevices([
      { manufacturer: "garmin", product: 4607, sourceType: "bluetoothLowEnergy", bleDeviceType: "heartRate", deviceIndex: 2 },
      { manufacturer: "other", product: 4607, sourceType: "antplus", antplusDeviceType: "heartRate", deviceIndex: 4 },
    ])).toEqual(["Garmin HRM 600", "External HR monitor (model not identified)"]);
    expect(externalHrDevices([{ manufacturer: 1, product: 5019, sourceType: "bluetoothLowEnergy", bleDeviceType: "heartRate" }])).toEqual(["Garmin CIRQA"]);
  });
  it("measures missing periods instead of stretching sparse data across the session", () => {
    const meta = analyseHr(
      [
        { time: 0, hr: 100 },
        { time: 1, hr: 110 },
        { time: 3599, hr: 120 },
      ],
      3600,
      "watch_recording",
    );
    expect(meta.coveragePct).toBeLessThan(2);
    expect(meta.longestGapS).toBeGreaterThan(3500);
    expect(analyseHr([], 3600).sampleCount).toBe(0);
  });
  it("rejects a corrupt FIT instead of attributing fabricated HR", () => {
    expect(() =>
      readHrRecording(new Uint8Array([1, 2, 3]), start, end),
    ).toThrow();
  });
});

describe("watch matching and preview", () => {
  it("waits without uploading and allows an explicit separate-activity choice", () => {
    expect(planSync(workout, [], DEFAULT_SYNC_SETTINGS).action).toBe("waiting");
    expect(
      planSync(workout, [], DEFAULT_SYNC_SETTINGS, undefined, true).action,
    ).toBe("upload");
  });
  it("requires a choice for ambiguous matches and rejects stale/ineligible selections", () => {
    const activities = [watch, { ...watch, activityId: 102 }];
    expect(planSync(workout, activities, DEFAULT_SYNC_SETTINGS).action).toBe(
      "review",
    );
    expect(
      planSync(workout, activities, DEFAULT_SYNC_SETTINGS, 102).selectedId,
    ).toBe(102);
    expect(
      planSync(workout, activities, DEFAULT_SYNC_SETTINGS, 999).action,
    ).toBe("review");
    expect(
      planSync(
        workout,
        [{ ...watch, startTimeGMT: "2026-10-27T08:00:00Z" }],
        DEFAULT_SYNC_SETTINGS,
      ).action,
    ).toBe("waiting");
  });
  it("shows what each strategy changes and preserves", () => {
    const merge = planSync(workout, [watch], DEFAULT_SYNC_SETTINGS);
    expect(merge.changes.join(" ")).toContain("Unknown");
    const replace = planSync(workout, [watch], {
      ...DEFAULT_SYNC_SETTINGS,
      merge: { ...DEFAULT_SYNC_SETTINGS.merge, watchStrategy: "replace" },
    });
    expect(replace.changes.join(" ")).toContain("do not transfer");
  });
  it("dry-run fetches the watch HR but writes nothing to either service or database", async () => {
    const g = gateway(),
      db = database();
    const result = await runEnhancedSync(
      deps(g),
      db.sql,
      DEFAULT_SYNC_SETTINGS,
      { dryRun: true, merge: DEFAULT_SYNC_SETTINGS.merge },
      syncOneWorkout,
    );
    expect(result.plan?.action).toBe("merge");
    expect(result.wouldUpload).toBe(false);
    expect(result.hr?.devices).toEqual(["Garmin HRM 600"]);
    expect(result.fitStats?.avgHr).toBeGreaterThan(90);
    expect(db.writes).toEqual([]);
    expect(g.upload).not.toHaveBeenCalled();
    expect(g.putExerciseSets).not.toHaveBeenCalled();
    expect(g.rename).not.toHaveBeenCalled();
  });
  it("a live wait never calls the write engine", async () => {
    const g = gateway();
    vi.mocked(g.activitiesByDate).mockResolvedValue([]);
    const engine = vi.fn();
    const result = await runEnhancedSync(
      deps(g),
      database().sql,
      DEFAULT_SYNC_SETTINGS,
      { dryRun: false },
      engine,
    );
    expect(result.status).toBe("merge_pending");
    expect(engine).not.toHaveBeenCalled();
    expect(g.upload).not.toHaveBeenCalled();
  });
  it("uses the watch HR even when enhancement is disabled", async () => {
    const g = gateway(),
      db = database();
    const settings = {
      ...DEFAULT_SYNC_SETTINGS,
      merge: { ...DEFAULT_SYNC_SETTINGS.merge, enabled: false },
    };
    const result = await runEnhancedSync(
      deps(g),
      db.sql,
      settings,
      { dryRun: true, merge: settings.merge },
      syncOneWorkout,
    );
    expect(result.hr?.devices).toEqual(["Garmin HRM 600"]);
    expect(result.hr?.source).toBe("watch_recording");
    expect(g.dailyHeartRate).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });
  it("shows the existing-activity dedup decision instead of promising a new upload", async () => {
    const g = gateway(),
      db = database();
    vi.mocked(g.findExistingActivity).mockResolvedValue(101);
    const settings = {
      ...DEFAULT_SYNC_SETTINGS,
      merge: { ...DEFAULT_SYNC_SETTINGS.merge, enabled: false },
    };
    const result = await runEnhancedSync(
      deps(g),
      db.sql,
      settings,
      { dryRun: true, merge: settings.merge },
      syncOneWorkout,
    );
    expect(result.plan?.action).toBe("describe");
    expect(result.wouldUpload).toBe(false);
    expect(g.upload).not.toHaveBeenCalled();
  });
  it("preserves original sensor attribution when resync reads an app-uploaded replacement", async () => {
    const g = gateway(generateFit(workout, points).fit),
      db = database(),
      dependencies = deps(g);
    dependencies.store.isSynced = async () => true;
    db.values.set("hr:workout-1", {
      metadata: {
        ...readHrRecording(sensorFit("CIRQA"), start, end, "99").metadata,
      },
    });
    const result = await runEnhancedSync(
      dependencies,
      db.sql,
      DEFAULT_SYNC_SETTINGS,
      { dryRun: true, targetHevyId: workout.id, targetActivityId: 101 },
      syncOneWorkout,
    );
    expect(result.hr?.devices).toEqual(["Garmin CIRQA"]);
    expect(result.hr?.sourceActivityId).toBe("99");
    expect(db.writes).toEqual([]);
  });
  it("keeps the original activity and uses its HR for merged dashboard statistics", async () => {
    const g = gateway(),
      db = database(),
      dependencies = deps(g);
    const result = await runEnhancedSync(
      dependencies,
      db.sql,
      { ...DEFAULT_SYNC_SETTINGS, hevyHrNotes: false },
      { dryRun: false, merge: DEFAULT_SYNC_SETTINGS.merge },
      syncOneWorkout,
    );
    expect(result.status).toBe("synced");
    expect(result.fitStats?.avgHr).toBeGreaterThan(90);
    expect(g.upload).not.toHaveBeenCalled();
    expect(g.deleteActivity).not.toHaveBeenCalled();
    expect(g.dailyHeartRate).not.toHaveBeenCalled();
    expect(db.values.get("hr:workout-1")).toMatchObject({
      metadata: { devices: ["Garmin HRM 600"] },
    });
  });
  it("a failed in-place merge cannot silently fall back to a new upload", async () => {
    const g = gateway();
    vi.mocked(g.putExerciseSets).mockRejectedValue(
      new Error("Garmin refused sets"),
    );
    const result = await runEnhancedSync(
      deps(g),
      database().sql,
      { ...DEFAULT_SYNC_SETTINGS, hevyHrNotes: false },
      { dryRun: false, merge: DEFAULT_SYNC_SETTINGS.merge },
      syncOneWorkout,
    );
    expect(result.status).toBe("needs_review");
    expect(g.upload).not.toHaveBeenCalled();
  });
  it("writes pounds in the note while keeping structured Garmin set weights in grams", async () => {
    const g = gateway();
    const result = await runEnhancedSync(deps(g), database().sql,
      { ...DEFAULT_SYNC_SETTINGS, weightUnit: "lb", hevyHrNotes: false },
      { dryRun: false, merge: DEFAULT_SYNC_SETTINGS.merge }, syncOneWorkout);
    expect(result.status).toBe("synced");
    expect(g.describe).toHaveBeenCalledWith(101, expect.stringContaining("110.2 lbs × 5"));
    expect(g.putExerciseSets).toHaveBeenCalledWith(101, expect.objectContaining({ exerciseSets: expect.arrayContaining([expect.objectContaining({ setType: "ACTIVE", weight: 50000 })]) }));
    expect(workout.exercises[0].sets[0].weight_kg).toBe(50);
  });
});

describe("replacement read-back gate", () => {
  it("refuses deletion without a verified backup", async () => {
    const g = gateway(),
      protectedGateway = protectReplacements(database().sql, g);
    await expect(protectedGateway.deleteActivity(101)).rejects.toThrow(
      "backup",
    );
    expect(g.deleteActivity).not.toHaveBeenCalled();
  });
  it("keeps the original when replacement HR is missing", async () => {
    const db = database(),
      original = sensorFit(),
      g = gateway(original);
    await saveOriginalBackup(db.sql, g, 101, workout, original, true);
    const safe = protectReplacements(db.sql, g);
    await safe.upload(original);
    vi.mocked(g.activityFit!).mockResolvedValue(generateFit(workout, null).fit);
    await expect(safe.deleteActivity(101)).rejects.toThrow(
      "missing heart-rate",
    );
    expect(g.deleteActivity).not.toHaveBeenCalled();
  });
  it("deletes only the original after backup, HR and exercise-name read-back succeed", async () => {
    const db = database(),
      bytes = sensorFit(),
      g = gateway(bytes);
    await saveOriginalBackup(db.sql, g, 101, workout, bytes, true);
    const safe = protectReplacements(db.sql, g);
    await safe.upload(bytes);
    await safe.deleteActivity(101);
    expect(g.deleteActivity).toHaveBeenCalledExactlyOnceWith(101);
    expect(db.values.has("original_fit_backup_101")).toBe(true);
  });
  it("blocks checksum corruption and read-back failures", async () => {
    const db = database(),
      bytes = sensorFit(),
      g = gateway(bytes);
    await saveOriginalBackup(db.sql, g, 101, workout, bytes, true);
    (db.values.get("original_fit_backup_101") as { sha256: string }).sha256 =
      "corrupt";
    await expect(
      protectReplacements(db.sql, g).deleteActivity(101),
    ).rejects.toThrow("checksum");
    expect(g.deleteActivity).not.toHaveBeenCalled();
  });
});
