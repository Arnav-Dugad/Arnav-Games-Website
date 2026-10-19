import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/Providers";
import { SiteChrome } from "@/components/layout/SiteChrome";
import { Footer } from "@/components/layout/Footer";
import { PageTransition } from "@/components/interactions/PageTransition";
import { THEME_BOOT_SCRIPT } from "@/lib/preferences/theme-script";
import { LaunchSplash } from "@/components/pwa/LaunchSplash";
import { PwaLayer } from "@/components/pwa/PwaLayer";
import { pwaBootScript } from "@/components/pwa/pwa-boot-script";
import { splashImages } from "@/components/pwa/splash-screens";

/* Dev builds also accept ?pwa-splash=1 to preview the launch splash in a tab. */
const PWA_BOOT_SCRIPT = pwaBootScript(process.env.NODE_ENV !== "production");

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
  // Home-screen app on iOS: full screen, content under a translucent status
  // bar (the header already pads for the safe area), and a launch image per
  // device class — iOS ignores the manifest for its launch screen.
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "black-translucent",
    startupImage: splashImages().map(({ url, media }) => ({ url, media })),
  },
  // Next emits only the standardised `mobile-web-app-capable`; older iOS
  // releases still key standalone launch (and startup images) off Apple's name.
  other: { "apple-mobile-web-app-capable": "yes" },
  // Stops iOS turning release years and prices into phone-number links.
  formatDetection: { telephone: false },
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
        {/* Installed-app launch splash decision + install-prompt capture; must precede first paint. */}
        <script dangerouslySetInnerHTML={{ __html: PWA_BOOT_SCRIPT }} />
      </head>
      <body className="min-h-dvh-safe bg-bg text-text antialiased">
        {/* Hidden unless the boot script marks a standalone cold start. */}
        <LaunchSplash />
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[500] focus:rounded-full focus:bg-brand focus:px-5 focus:py-3 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>

        <Providers>
          <SiteChrome />
          {/* Service worker, offline pill, install prompt, installed-app chrome. */}
          <PwaLayer />
          {/* Route-change view transition; see PageTransition. */}
          <main id="main"><PageTransition>{children}</PageTransition></main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
