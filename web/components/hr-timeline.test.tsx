import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HrTimeline } from "./hr-timeline";
import { analyseHr } from "@/lib/hr-analysis";
describe("HR timeline presentation", () => {
  it("separates missing periods and uses elapsed time for the X axis", () => {
    const points = [
      { time: 0, hr: 90 },
      { time: 10, hr: 110 },
      { time: 300, hr: 130 },
      { time: 310, hr: 120 },
    ];
    const metadata = {
      ...analyseHr(points, 360, "watch_recording", ["Garmin HRM 600"]),
      medianIntervalS: 10,
    };
    const html = renderToStaticMarkup(
      <HrTimeline hevyId="test" initialData={{ points, metadata }} />,
    );
    expect(html.match(/<polyline /g)).toHaveLength(2);
    expect(html).toContain("Garmin HRM 600");
    expect(html).toContain("6:00");
    expect(html).toContain('aria-label="Inspect HR reading"');
    expect(html).not.toContain("serialNumber");
  });
  it("does not invent a time axis for a legacy cache with no timestamps", () => {
    const html = renderToStaticMarkup(
      <HrTimeline hevyId="test" initialData={{ samples: [90, 100, 110] }} />,
    );
    expect(html).not.toContain("<polyline");
    expect(html).toContain("no timestamps");
    expect(html).toContain("source not identified");
  });
});
