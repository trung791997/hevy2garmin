import { describe, it, expect, vi } from "vitest";
import { DEFAULT_SSO_WORKER_URL } from "garmin-auth";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

import { ConnectGarmin, WORKER_EXCHANGE_URL } from "./connect-garmin";

// The browser sign-in posted its ticket to a deleted worker, so every attempt
// failed. It must use the shared worker that garmin-auth itself points at.
describe("Garmin browser sign-in", () => {
  it("keeps cloud setup password-free and explains the ticket exchange", () => {
    const html = renderToStaticMarkup(createElement(ConnectGarmin, { connected: false, browserOnly: true, directLogin: false }));
    expect(html).toContain("https://sso.garmin.com/sso/signin");
    expect(html).toContain("Cloudflare sign-in service");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('type="email"');
  });

  it("browser-only setup shows Garmin's sign-in link and a ticket form without password inputs", () => {
    const html = renderToStaticMarkup(createElement(ConnectGarmin, { connected: false, browserOnly: true, directLogin: true }));
    expect(html).toContain("https://sso.garmin.com/sso/signin");
    expect(html).toContain('aria-label="Garmin ticket URL"');
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('type="email"');
    expect(html).not.toContain("Back to password sign-in");
  });

  it("exchanges the ticket on the shared SSO worker", () => {
    expect(WORKER_EXCHANGE_URL).toBe(`${DEFAULT_SSO_WORKER_URL}/exchange`);
  });
});
