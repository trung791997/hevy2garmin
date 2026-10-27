"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { withBasePath } from "@/lib/base-path";

function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const params = useSearchParams();
  // Surface a server-provided ?error= on first render (e.g. an expired session
  // redirect), matching the Python login form's error passthrough.
  const initialError = params.get("error") ?? "";
  const [shownInitial, setShownInitial] = useState(false);
  if (initialError && !shownInitial) {
    setShownInitial(true);
    setError(initialError);
  }

  function safeNext(raw: string | null): string {
    if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/dashboard";
    return raw;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const next = safeNext(params.get("next"));
    try {
      const res = await fetch(withBasePath(`/api/login?next=${encodeURIComponent(next)}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; next?: string; error?: string };
      if (res.ok && data.ok) {
        router.push(safeNext(data.next ?? next));
        router.refresh();
      } else {
        // Server message covers both "Incorrect password" and the rate-limit
        // "Too many attempts. Try again in …" cooldown (HTTP 429).
        setError(data.error ?? "Incorrect password");
        setLoading(false);
      }
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-brand"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 7h14m-4-4 4 4-4 4M21 17H7m4-4-4 4 4 4" /></svg><span>hevy<span className="text-text-muted">2</span>garmin</span></div>
      <h1>Sign in</h1>
      <p className="mb-7 text-sm text-text-muted">Enter your dashboard password to continue.</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div>
        <label htmlFor="dashboard-password">Dashboard password</label>
        <input
          id="dashboard-password"
          type="password"
          autoComplete="current-password"
          data-testid="login-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
        />
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <button
          type="submit"
          data-testid="login-submit"
          disabled={loading || password.length === 0}
          className="login-submit"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
