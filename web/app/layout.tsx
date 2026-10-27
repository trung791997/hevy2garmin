import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { NavBar } from "@/components/nav-bar";
import { authEnabled } from "@/lib/auth";
import { withBasePath } from "@/lib/base-path";
import { clientErrorScript } from "@/lib/visit-counter";
import "./globals.css";

const manrope = localFont({
  src: "./fonts/Manrope-Variable.ttf",
  display: "swap",
  variable: "--font-manrope",
  weight: "200 800",
  adjustFontFallback: false,
  fallback: ["system-ui", "sans-serif"],
});

export const metadata: Metadata = {
  title: "hevy2garmin",
  description: "Sync your Hevy workouts to Garmin Connect",
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${manrope.variable}`}>
      <head>
        {/* Optional error reports: forwarded only when a collector is configured. */}
        <script dangerouslySetInnerHTML={{ __html: clientErrorScript(withBasePath("/api/client-error")) }} />
      </head>
      <body className="bg-base text-text min-h-screen antialiased">
        <NavBar authEnabled={authEnabled()} />
        <div id="main-content" className="app-content" tabIndex={-1}>{children}</div>
      </body>
    </html>
  );
}
