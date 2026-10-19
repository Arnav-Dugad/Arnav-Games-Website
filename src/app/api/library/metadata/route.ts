import { NextResponse } from "next/server";
import { igdbConfigured, listGamesByIds } from "@/lib/games/providers/igdb";
import { timeToBeatFor } from "@/lib/games/providers/igdb-extras";
import type { GameSummary, TimeToBeat } from "@/lib/games/types";

export const dynamic = "force-dynamic";

type Include = "games" | "timeToBeat";

/**
 * Public catalogue repair endpoint. It returns no personal data.
 *
 * Body: `{ ids: number[], include?: ("games" | "timeToBeat")[] }`. `include`
 * defaults to `["games"]`, which is what the library's background metadata
 * refresh has always sent; the stats page asks for `["timeToBeat"]` alone so
 * it doesn't pay for a summary query it would throw away.
 *
 * `timeToBeatAvailable` is false only when there is no IGDB to ask. A game
 * IGDB has no completion times for is simply absent from `timeToBeat`, and
 * the stats page reports that as missing coverage rather than as zero hours.
 */
export async function POST(request: Request) {
  const syncedAt = Date.now();
  try {
    const body = await request.json() as { ids?: unknown; include?: unknown };
    const ids = Array.isArray(body.ids)
      ? [...new Set(body.ids.filter((id): id is number => Number.isInteger(id) && Number(id) > 0))].slice(0, 100)
      : [];
    const include = new Set<Include>(
      Array.isArray(body.include)
        ? body.include.filter((item): item is Include => item === "games" || item === "timeToBeat")
        : ["games"],
    );

    if (ids.length === 0 || !igdbConfigured()) {
      return NextResponse.json({ games: [], timeToBeatAvailable: false, syncedAt });
    }

    const [games, timeToBeat] = await Promise.all([
      include.has("games") ? listGamesByIds(ids) : Promise.resolve<GameSummary[]>([]),
      // The helper never throws (enrichment must not fail a request); a
      // transport failure comes back as an empty map.
      include.has("timeToBeat") ? timeToBeatFor(ids) : Promise.resolve(new Map<number, TimeToBeat>()),
    ]);

    return NextResponse.json(
      {
        games,
        ...(include.has("timeToBeat")
          ? { timeToBeat: Object.fromEntries(timeToBeat) as Record<string, TimeToBeat>, timeToBeatAvailable: true }
          : {}),
        syncedAt,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[library/metadata] refresh failed", error);
    return NextResponse.json({ games: [], timeToBeatAvailable: false, syncedAt }, { status: 200 });
  }
}
