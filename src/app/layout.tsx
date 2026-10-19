import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { SiteChrome } from "@/components/layout/SiteChrome";
import { Footer } from "@/components/layout/Footer";
import { PageTransition } from "@/components/interactions/PageTransition";
import { Suspense } from "react";
import { AnalyticsTracker } from "@/components/admin/AnalyticsTracker";
import { THEME_BOOT_SCRIPT } from "@/lib/preferences/theme-script";

/**
 * SF Pro is used directly on Apple devices (see `--font-sans` in globals.css);
 * Inter is the fallback everywhere else, being the closest open match to it.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const SITE_NAME = "Arnav Games";
const SITE_DESCRIPTION =
  "Track every upcoming video game release, browse critic scores, platforms and screenshots, and build a watchlist of what you're waiting for.";

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL at build time so social cards resolve absolute URLs.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: `${SITE_NAME} — Upcoming video game releases & database`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "video game releases",
    "upcoming games",
    "game release dates",
    "game database",
    "metacritic scores",
    "game watchlist",
  ],
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — Upcoming video game releases`,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Upcoming video game releases`,
    description: SITE_DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  // Never block pinch-zoom — capping it fails WCAG 1.4.4.
  maximumScale: 5,
  viewportFit: "cover",
};

/* Deliberately static so catalogue pages keep prerendering and ISR. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Resolves the saved/OS appearance before first paint (no flash). */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh-safe bg-bg text-text antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[500] focus:rounded-full focus:bg-brand focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>

        <Providers>
          <SiteChrome />
          {/* Route-change view transition; see PageTransition. */}
          <main id="main"><PageTransition>{children}</PageTransition></main>
          <Footer />
        </Providers>
        {/* Cookieless first-party analytics. Suspense keeps its useSearchParams
            from opting static routes out of prerendering. */}
        <Suspense fallback={null}>
          <AnalyticsTracker />
        </Suspense>
      </body>
    </html>
  );
}
