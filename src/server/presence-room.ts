/**
 * Durable Object counting visitors online right now, for /admin.
 *
 * Placeholder implementation — replaced by the analytics work. It is wired
 * into the Worker entry (worker.mjs) and bound as `PRESENCE` in wrangler.jsonc.
 */
export class PresenceRoom {
  constructor(
    private readonly state: unknown,
    private readonly env: unknown,
  ) {}

  async fetch(): Promise<Response> {
    return Response.json({ online: 0 });
  }
}
