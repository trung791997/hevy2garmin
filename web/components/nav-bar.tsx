"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { withBasePath } from "@/lib/base-path";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/workouts", label: "Workouts", icon: "workouts" },
  { href: "/routines", label: "Routines", icon: "routines" },
  { href: "/mappings", label: "Mappings", icon: "mappings" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/settings", label: "Settings", icon: "settings" },
  { href: "/setup", label: "Setup", icon: "setup" },
] as const;

function NavIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    workouts: <path d="m6 6 12 12M4 9l5-5m6 16 5-5M2 7l5-5m10 20 5-5" />,
    routines: <><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M8 3v4m8-4v4M4 11h16m-12 4h3m2 0h3" /></>,
    mappings: <path d="M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4" />,
    history: <path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-4v5l3 2" />,
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="8" cy="7" r="2" /><circle cx="16" cy="17" r="2" /></>,
    setup: <><path d="m9 15-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0M8 12h8" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    logout: <path d="M9 4H4v16h5m5-13 5 5-5 5m-6-5h11" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function NavBar({ authEnabled = false }: { authEnabled?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!moreOpen) return;
    function dismissOutside(event: PointerEvent) {
      if (event.target instanceof Element && !event.target.closest(".mobile-nav, .more-navigation")) setMoreOpen(false);
    }
    function dismissWithEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    }
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [moreOpen]);

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  if (pathname === "/login") return null;

  async function logout() {
    setLoggingOut(true);
    try { await fetch(withBasePath("/api/logout"), { method: "POST" }); } catch { /* Navigate even if the session already expired. */ }
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <div className="app-header-inner">
          <Link href="/dashboard" className="app-brand" aria-label="hevy2garmin dashboard">
            <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 7h14m-4-4 4 4-4 4M21 17H7m4-4-4 4 4 4" /></svg>
            <span>hevy<span className="text-text-muted">2</span>garmin</span>
          </Link>
          <nav className="desktop-nav" aria-label="Main navigation">
            {NAV_ITEMS.map(({ href, label }) => (
              <Link key={href} href={href} aria-current={isActive(href) ? "page" : undefined} className="desktop-nav-link">{label}</Link>
            ))}
          </nav>
          {authEnabled && <button type="button" onClick={logout} disabled={loggingOut} className="desktop-logout">{loggingOut ? "Logging out…" : "Log out"}</button>}
          <Link href="/settings" className="mobile-settings" aria-label="Settings"><NavIcon name="settings" /></Link>
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.slice(0, 3).map(({ href, label, icon }) => (
          <Link key={href} href={href} onClick={() => setMoreOpen(false)} aria-current={isActive(href) ? "page" : undefined} className="mobile-nav-item"><NavIcon name={icon} /><span>{label}</span></Link>
        ))}
        <button ref={moreButtonRef} type="button" className="mobile-nav-item" onClick={() => setMoreOpen(!moreOpen)} aria-expanded={moreOpen} aria-controls="more-navigation" aria-label={moreOpen ? "Close more navigation" : "More navigation"} data-active={NAV_ITEMS.slice(3).some(({ href }) => isActive(href)) || moreOpen}>
          <NavIcon name={moreOpen ? "close" : "more"} /><span>More</span>
        </button>
      </nav>
      {moreOpen && <nav id="more-navigation" className="more-navigation" aria-label="More pages">
          <div className="more-navigation-heading"><span>More</span><button type="button" onClick={() => setMoreOpen(false)} aria-label="Close menu"><NavIcon name="close" /></button></div>
          {NAV_ITEMS.slice(3).map(({ href, label, icon }) => (
            <Link key={href} href={href} onClick={() => setMoreOpen(false)} aria-current={isActive(href) ? "page" : undefined}><NavIcon name={icon} />{label}</Link>
          ))}
          {authEnabled && <button type="button" onClick={logout} disabled={loggingOut} className="more-logout"><NavIcon name="logout" />{loggingOut ? "Logging out…" : "Log out"}</button>}
      </nav>}
    </>
  );
}
