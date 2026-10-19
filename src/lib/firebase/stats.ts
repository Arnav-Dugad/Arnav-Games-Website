/**
 * Browser reads of our public statistics documents (see
 * `src/lib/games/stats-docs.ts` for the model and `firestore.rules` for the
 * read-only rules).
 *
 * Reading these straight from Firestore, instead of through a Worker route,
 * is the point: each chart on the game page used to cost a Cloudflare Worker
 * request (and a D1 query); now it costs one Firestore document read and no
 * Worker time at all. Writes only ever come from the server.
 */

import { doc, getDoc } from "firebase/firestore";
import { getDb } from "./config";

/**
 * One public stats document's data; null when it doesn't exist or Firebase
 * isn't configured (both read as "nothing recorded"). Throws on a failed
 * read, so callers can tell "couldn't ask" from "nothing there".
 */
export async function readStatsDoc(collection: string, id: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  if (!db) return null;
  const snap = await getDoc(doc(db, collection, id));
  return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
}
