import { withBasePath } from "@/lib/base-path";

/** A compact explanation of the real sync pipeline; kept out of the daily workflow. */
export function PipelineDiagram({ mappingCount = 433 }: { mappingCount?: number }) {
  return (
    <details className="pipeline-details">
      <summary>How syncing works<svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg></summary>
      <ol className="pipeline-steps">
        <li><strong>1. Read from Hevy</strong>Fetch the workout with its exercises, sets, reps, and weights.</li>
        <li><strong>2. Map exercises</strong>Translate exercise names using {mappingCount.toLocaleString()} built-in mappings.</li>
        <li><strong>3. Build the FIT file</strong>Include workout timing, calories, and available heart-rate data.</li>
        <li><strong>4. Sync to Garmin</strong>Check for an existing activity before matching or uploading.</li>
      </ol>
      <p className="pipeline-note">Heart-rate fusion matches your Garmin watch data to the workout. Manage it in <a href={withBasePath("/settings")} className="text-link">Settings</a>.</p>
    </details>
  );
}
