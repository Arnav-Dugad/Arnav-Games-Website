/**
 * Durable Object counting visitors online right now, for /admin.
 *
 * One global instance (`idFromName("global")`) holds every open tab in memory
 * — see `PresenceBook` for the rules. Bundled by wrangler from worker.mjs and
 * bound as `PRESENCE`; never import it from Next code (it needs the Workers
 * runtime). Next routes talk to it over `stub.fetch`:
 *
 *   POST /beat      `{ id, path }` or `{ id, leave: true }` → 204
 *   GET  /snapshot  → `{ online, pages, updatedAt }`
 *
 * Nothing is persisted: if the object is evicted, the next heartbeats (every
 * 30s per visible tab) rebuild the picture within one beat interval. The only
 * storage use is the alarm that sweeps expired tabs while anyone is online.
 */

import { DurableObject } from "cloudflare:workers";
// Relative, not `@/…`: wrangler bundles this outside Next's resolver.
import { PRESENCE_SWEEP_MS, PresenceBook, parseBeat } from "../lib/analytics/presence";

export class PresenceRoom extends DurableObject {
  private readonly book = new PresenceBook();
  /** Avoids a storage round-trip per beat once an alarm is known to be set. */
  private alarmPending = false;

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const now = Date.now();

    if (request.method === "POST" && pathname === "/beat") {
      const beat = parseBeat(await request.json().catch(() => null));
      if (!beat) return new Response(null, { status: 400 });
      this.book.apply(beat, now);
      if (!beat.leave) await this.ensureAlarm(now);
      return new Response(null, { status: 204 });
    }

    if (request.method === "GET" && pathname === "/snapshot") {
      return Response.json(this.book.snapshot(now), { headers: { "Cache-Control": "no-store" } });
    }

    return new Response(null, { status: 404 });
  }

  async alarm(): Promise<void> {
    this.alarmPending = false;
    const now = Date.now();
    this.book.sweep(now);
    // Re-arm only while someone is online; an empty room goes quiet and
    // costs nothing until the next heartbeat.
    if (this.book.size > 0) await this.ensureAlarm(now);
  }

  private async ensureAlarm(now: number): Promise<void> {
    if (this.alarmPending) return;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(now + PRESENCE_SWEEP_MS);
    }
    this.alarmPending = true;
  }
}
