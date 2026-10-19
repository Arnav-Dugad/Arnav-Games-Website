import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { SiteChrome } from "@/components/layout/SiteChrome";
import { Footer } from "@/components/layout/Footer";

/**
 * Sora carries the display voice (tight, geometric, high contrast at large
 * sizes); Inter handles body copy where legibility at 13–16px matters more.
 * Both are loaded as variables so CSS decides which is used where.
 */
const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap",
  weight: ["400", "600", "700", "800"],
});

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
  themeColor: "#04040a",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  // Never block pinch-zoom — capping it fails WCAG 1.4.4.
  maximumScale: 5,
  viewportFit: "cover",
};

/* Deliberately static so catalogue pages keep prerendering and ISR. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${inter.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh-safe bg-bg text-text antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[500] focus:rounded-full focus:bg-brand focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>

        <Providers>
          <SiteChrome />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
