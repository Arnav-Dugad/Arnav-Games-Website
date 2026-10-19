/*
 * Minimal types for the `cloudflare:workers` runtime module, for
 * `presence-room.ts`. The full `@cloudflare/workers-types` package would
 * replace the DOM's fetch/Response typings project-wide and break client code
 * (see lib/cloudflare/db.ts), so only what this repo touches is declared.
 * No top-level import/export: this must stay an ambient declaration.
 */
declare module "cloudflare:workers" {
  interface DurableObjectStorageLike {
    getAlarm(): Promise<number | null>;
    setAlarm(scheduledTime: number | Date): Promise<void>;
    deleteAlarm(): Promise<void>;
  }
  interface DurableObjectStateLike {
    readonly storage: DurableObjectStorageLike;
    waitUntil(promise: Promise<unknown>): void;
  }
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectStateLike;
    protected env: Env;
    constructor(ctx: DurableObjectStateLike, env: Env);
    fetch?(request: Request): Response | Promise<Response>;
    alarm?(): void | Promise<void>;
  }
}
