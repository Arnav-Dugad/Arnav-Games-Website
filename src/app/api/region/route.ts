import { NextResponse } from "next/server";

/**
 * The visitor's country, from Cloudflare's `cf-ipcountry` header. Used only
 * to pick a default price region; nothing is stored. Null locally.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const raw = request.headers.get("cf-ipcountry")?.toUpperCase() ?? null;
  // "XX" = unknown, "T1" = Tor; neither is a storefront.
  const country = raw && /^[A-Z]{2}$/.test(raw) && raw !== "XX" && raw !== "T1" ? raw : null;
  return NextResponse.json({ country }, { headers: { "Cache-Control": "private, no-store" } });
}
