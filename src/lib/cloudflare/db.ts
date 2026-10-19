import { getCloudflareContext } from "@opennextjs/cloudflare";

/*
 * The slice of the D1 API this app uses. Declared locally because pulling in
 * the full Workers runtime types replaces the DOM's `fetch`/`Response`
 * typings project-wide and breaks client code.
 */
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

/**
 * The D1 database (`DB` binding), or null when it isn't available — during
 * `next build`, in tests, or anywhere outside the Workers runtime. Callers
 * must treat null as "feature quietly off", never as an error.
 */
export async function getDb(): Promise<D1Database | null> {
  try {
    const { env } = await getCloudflareContext({ async: true });
    return ((env as unknown as { DB?: D1Database }).DB) ?? null;
  } catch {
    return null;
  }
}

/**
 * Runs `task` after the response is sent when the runtime supports it, so
 * bookkeeping writes (analytics, release history) never add latency.
 */
export async function runAfterResponse(task: Promise<unknown>): Promise<void> {
  try {
    const { ctx } = await getCloudflareContext({ async: true });
    ctx.waitUntil(task.catch(() => {}));
  } catch {
    await task.catch(() => {});
  }
}
