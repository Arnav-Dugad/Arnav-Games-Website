import { NextResponse } from "next/server";
import { commitWrites, fieldPath, getDocument, type FieldTransform } from "@/lib/firebase/server";
import { serviceAccount } from "@/lib/firebase/server/credentials";
import { verifyIdToken } from "@/lib/firebase/server/id-token";
import { isPlayerTag, parseMyTags, type PlayerTag } from "@/lib/games/community-tags";
import { FetchBudget } from "@/lib/games/fetch-budget";

/**
 * POST /api/tags — a signed-in reader sets their tags for one game.
 *
 *   Authorization: Bearer <Firebase ID token>
 *   { gameId: number, tags: PlayerTag[], custom?: string[] }
 *
 * The token is verified here (`verifyIdToken`), the reader's previous tags
 * are read from `users/{uid}/gameTags/{gameId}`, and one atomic commit both
 * replaces that record and moves the public counts in
 * `communityTags/{gameId}` by the difference. Each reader therefore counts
 * at most once per tag, re-saving is idempotent, and the counts can't be
 * written by anyone else (clients are refused by firestore.rules). Custom
 * tags are stored privately and never counted.
 *
 * At most three outbound requests: Google's signing keys (cached for hours),
 * one read, one commit.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const account = await serviceAccount();
  if (!account) return fail(503, "Tags aren't available on this deployment.");

  const budget = new FetchBudget(6);
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const user = await verifyIdToken(token, account.projectId, budget);
  if (!user) return fail(401, "Sign in again to tag games.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "Expected JSON.");
  }
  const gameId = (body as { gameId?: unknown })?.gameId;
  const mine = parseMyTags(body);
  if (typeof gameId !== "number" || !Number.isInteger(gameId) || gameId === 0 || Math.abs(gameId) > 2 ** 31 || !mine) {
    return fail(400, "Those tags couldn't be saved.");
  }

  const userPath = `users/${user.uid}/gameTags/${gameId}`;
  const previous = await getDocument(userPath, { budget });
  if (previous === undefined) return fail(503, "Couldn't reach the database. Try again.");
  const before = new Set(((previous?.data.tags as unknown[]) ?? []).filter(isPlayerTag));
  const after = new Set<PlayerTag>(mine.tags);

  const transforms: FieldTransform[] = [];
  for (const tag of after) if (!before.has(tag)) transforms.push({ field: fieldPath("counts", tag), op: "increment", value: 1 });
  for (const tag of before) if (!after.has(tag)) transforms.push({ field: fieldPath("counts", tag), op: "increment", value: -1 });
  // `taggers` counts readers with at least one public tag on this game.
  const taggerDelta = (after.size > 0 ? 1 : 0) - (before.size > 0 ? 1 : 0);
  if (taggerDelta) transforms.push({ field: "taggers", op: "increment", value: taggerDelta });

  const now = Date.now();
  const empty = mine.tags.length === 0 && mine.custom.length === 0;
  const committed = await commitWrites(
    [
      empty
        ? { type: "delete", path: userPath }
        : { type: "update", path: userPath, data: { gameId, tags: mine.tags, custom: mine.custom, updatedAt: now } },
      ...(transforms.length
        ? [{ type: "update" as const, path: `communityTags/${gameId}`, data: {}, mask: [], transforms: [...transforms, { field: "updatedAt", op: "serverTime" as const }] }]
        : []),
    ],
    { budget },
  );
  if (committed === 0) return fail(503, "Couldn't save your tags. Try again.");
  return NextResponse.json({ tags: mine.tags, custom: mine.custom }, { headers: NO_STORE });
}
