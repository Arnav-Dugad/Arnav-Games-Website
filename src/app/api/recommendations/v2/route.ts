import { NextResponse } from "next/server";
import { recommendationsV2 } from "@/lib/recs/engine";
import { parseRecsProfile } from "@/lib/recs/profile";

/**
 * Recommendations v2, as `RecommendationsV2`:
 *
 *   POST /api/recommendations/v2
 *   { "v": 2, "seeds": [{ "id": 119133, "w": 2.6 }, { "id": 1942, "w": -1.5 }],
 *     "exclude": [119133, 1942], "dismissed": [], "ignored": [],
 *     "platforms": ["pc", "ps5"], "services": ["game-pass"], "lengthHours": 30 }
 *
 * The body is the anonymous profile from `buildTasteProfile` (src/lib/recs/
 * profile.ts) — game ids and weights only; no uid or personal data. A thin
 * profile still answers, with `personalised: false` quality picks.
 *
 * POST bodies aren't cached by browsers, so the client should keep the answer
 * on the device (keyed by `profileKey(profile)`, ~6 h) — the server caches
 * the same 6 h per profile. 503 when IGDB can't answer.
 *
 * Outbound requests: ≤ ~17 with every cache cold, 0 warm (see engine.ts).
 */

const MAX_BODY = 32_000;

export async function POST(request: Request) {
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY) {
    return NextResponse.json({ error: "body too large" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const profile = parseRecsProfile(raw);
  if (typeof profile === "string") {
    return NextResponse.json({ error: profile }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const recs = await recommendationsV2(profile);
  if (!recs) {
    return NextResponse.json({ error: "recommendations unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(recs, { headers: { "Cache-Control": "private, no-store" } });
}
