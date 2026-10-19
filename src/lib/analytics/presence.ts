/**
 * The live "online now" bookkeeping, as plain logic.
 *
 * Lives here rather than inside the Durable Object so it can be type-checked
 * and unit-tested without the Workers runtime; `src/server/presence-room.ts`
 * is a thin shell around it. Must stay dependency-free: wrangler bundles it
 * straight into the Worker entry, outside Next's module graph.
 *
 * State is memory only. A tab is "online" for `PRESENCE_TTL_MS` after its
 * last heartbeat (beats are every 30s, so one lost beat doesn't drop it).
 * Tab ids are random per page load and never leave this object.
 */

export const PRESENCE_TTL_MS = 75_000;
/** How often the Durable Object's alarm sweeps while anyone is online. */
export const PRESENCE_SWEEP_MS = 30_000;
/** Memory guard: a flood of fake ids can't grow the map without bound. */
export const PRESENCE_MAX_TABS = 20_000;

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

export interface PresenceBeat {
  id: string;
  path?: string;
  leave?: boolean;
}

/** Validates an untrusted beat; null when malformed. */
export function parseBeat(input: unknown): PresenceBeat | null {
  if (typeof input !== "object" || input === null) return null;
  const { id, path, leave } = input as Record<string, unknown>;
  if (typeof id !== "string" || !ID_RE.test(id)) return null;
  if (leave === true) return { id, leave: true };
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 200) return null;
  return { id, path };
}

export class PresenceBook {
  private readonly tabs = new Map<string, { path: string; expires: number }>();

  get size(): number {
    return this.tabs.size;
  }

  /** Applies a validated beat. */
  apply(beat: PresenceBeat, now: number): void {
    if (beat.leave) {
      this.tabs.delete(beat.id);
      return;
    }
    if (!this.tabs.has(beat.id) && this.tabs.size >= PRESENCE_MAX_TABS) {
      this.sweep(now);
      if (this.tabs.size >= PRESENCE_MAX_TABS) return;
    }
    this.tabs.set(beat.id, { path: beat.path ?? "/", expires: now + PRESENCE_TTL_MS });
  }

  sweep(now: number): void {
    for (const [id, tab] of this.tabs) {
      if (tab.expires <= now) this.tabs.delete(id);
    }
  }

  snapshot(now: number, limit = 8): { online: number; pages: { path: string; count: number }[]; updatedAt: number } {
    this.sweep(now);
    const counts = new Map<string, number>();
    for (const tab of this.tabs.values()) counts.set(tab.path, (counts.get(tab.path) ?? 0) + 1);
    const pages = [...counts.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
      .slice(0, limit);
    return { online: this.tabs.size, pages, updatedAt: now };
  }
}
