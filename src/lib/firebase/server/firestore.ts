/**
 * Server-side Firestore over REST.
 *
 *   https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents
 *
 * The Admin SDK needs Node (gRPC), and the web SDK can't run in the Worker
 * (see next.config.ts), so the server talks to Firestore with plain `fetch`,
 * authenticated as the service account (`token.ts`). Security rules don't
 * apply to these calls — the service account has full access — which is why
 * every public collection is client read-only and written only from here.
 *
 * Budget-aware: on Workers Free every call here is one of the invocation's 50
 * subrequests (D1 calls used to be free bindings). Each helper takes an
 * optional budget and refuses — returning null, never throwing — when the
 * request wouldn't fit. Batch where you can: `batchGet` reads many documents
 * and `commit` writes up to 500 in one request.
 *
 * Failure is always `null` (or `false` for writes), distinct from a missing
 * document, so callers can tell "nothing recorded" from "couldn't ask".
 */

import { serviceAccount, type ServiceAccount } from "./credentials";
import { bearerToken, canFallBack, rejectBearer } from "./token";
import { decodeFields, encodeFields, encodeValue, type FsFields, type FsValue } from "./values";

/** The part of `FetchBudget` used here, so scripts can pass their own. */
export interface Budget {
  take(n?: number): boolean;
}

export interface FsDocument {
  /** Path relative to the database root, e.g. `playerHistory/1245620`. */
  path: string;
  data: Record<string, unknown>;
  updateTime: string | null;
}

export type FieldTransform =
  | { field: string; op: "maximum" | "minimum" | "increment"; value: number }
  | { field: string; op: "serverTime" };

export type Write =
  | {
      type: "update";
      path: string;
      /** Plain data; nested objects become maps. */
      data: Record<string, unknown>;
      /**
       * Field paths to touch (see `fieldPath`). Paths present in `data` are
       * set, paths absent from it are *deleted* — Firestore's own mask rule,
       * which is how old samples are pruned without reading the document.
       * Omit to replace the whole document with `data`.
       */
      mask?: string[];
      transforms?: FieldTransform[];
      /** Precondition: true = must exist, false = must not exist. */
      exists?: boolean;
    }
  | { type: "delete"; path: string };

const TIMEOUT_MS = 8000;
/** Firestore's ceiling on writes per commit. */
export const MAX_WRITES_PER_COMMIT = 500;
/** Keeps each batchGet response (and its JSON parse) modest. */
const MAX_DOCS_PER_GET = 100;

function root(account: ServiceAccount) {
  return `projects/${account.projectId}/databases/(default)/documents`;
}

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

function toDocument(account: ServiceAccount, raw: { name?: string; fields?: FsFields; updateTime?: string }): FsDocument {
  const prefix = `${root(account)}/`;
  const name = raw.name ?? "";
  return {
    path: name.startsWith(prefix) ? name.slice(prefix.length) : name,
    data: decodeFields(raw.fields),
    updateTime: raw.updateTime ?? null,
  };
}

/** Whether a service account is configured at all. */
export async function firestoreConfigured(): Promise<boolean> {
  return (await serviceAccount()) !== null;
}

/**
 * One authorised request, retried once with an OAuth token if the
 * self-signed bearer is ever rejected. Charges `budget` for every outbound
 * request it makes (the request itself, plus a token exchange when needed).
 */
async function call<T>(
  method: "GET" | "POST",
  url: (account: ServiceAccount) => string,
  body: unknown,
  budget: Budget | undefined,
  allow404 = false,
): Promise<{ status: number; data: T | null } | null> {
  const account = await serviceAccount();
  if (!account) return null;

  for (let attempt = 0; attempt < 2; attempt++) {
    if (budget && !budget.take()) return null;
    const bearer = await bearerToken(account);
    if (!bearer) return null;
    if (bearer.fetched) budget?.take();
    let res: Response;
    try {
      res = await fetch(url(account), {
        method,
        headers: {
          Authorization: `Bearer ${bearer.token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      console.warn("[firestore] request failed:", err instanceof Error ? err.message : err);
      return null;
    }
    if (res.status === 401 && attempt === 0 && canFallBack()) {
      rejectBearer();
      continue;
    }
    if (allow404 && res.status === 404) return { status: 404, data: null };
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`[firestore] ${method} → ${res.status} ${detail.slice(0, 300)}`);
      return null;
    }
    return { status: res.status, data: (await res.json()) as T };
  }
  return null;
}

function maskQuery(mask: string[] | undefined) {
  return mask && mask.length > 0 ? `?${mask.map((path) => `mask.fieldPaths=${encodeURIComponent(path)}`).join("&")}` : "";
}

/**
 * One document. `mask` limits the fields returned (field paths). Resolves to
 * the document, `null` when it doesn't exist, or `undefined` on failure.
 */
export async function getDocument(
  path: string,
  options: { mask?: string[]; budget?: Budget } = {},
): Promise<FsDocument | null | undefined> {
  const result = await call<{ name?: string; fields?: FsFields; updateTime?: string }>(
    "GET",
    (account) => `https://firestore.googleapis.com/v1/${root(account)}/${encodePath(path)}${maskQuery(options.mask)}`,
    undefined,
    options.budget,
    true,
  );
  if (!result) return undefined;
  if (result.status === 404 || !result.data) return null;
  const account = (await serviceAccount())!;
  return toDocument(account, result.data);
}

/**
 * Many documents in one request (per 100). Every requested path is in the
 * result map — `null` for a document that doesn't exist. Resolves to null
 * when any chunk failed, so callers never mistake "unread" for "empty".
 */
export async function batchGetDocuments(
  paths: string[],
  options: { mask?: string[]; budget?: Budget } = {},
): Promise<Map<string, FsDocument | null> | null> {
  const unique = [...new Set(paths)];
  const out = new Map<string, FsDocument | null>();
  if (unique.length === 0) return out;
  const account = await serviceAccount();
  if (!account) return null;

  for (let i = 0; i < unique.length; i += MAX_DOCS_PER_GET) {
    const chunk = unique.slice(i, i + MAX_DOCS_PER_GET);
    const result = await call<Array<{ found?: { name?: string; fields?: FsFields; updateTime?: string }; missing?: string }>>(
      "POST",
      (acc) => `https://firestore.googleapis.com/v1/${root(acc)}:batchGet`,
      {
        documents: chunk.map((path) => `${root(account)}/${path}`),
        ...(options.mask ? { mask: { fieldPaths: options.mask } } : {}),
      },
      options.budget,
    );
    if (!result?.data) return null;
    for (const path of chunk) out.set(path, null);
    for (const row of result.data) {
      if (row.found) {
        const doc = toDocument(account, row.found);
        out.set(doc.path, doc);
      }
    }
  }
  return out;
}

/**
 * A structured query against one collection (`parent` is a document path
 * for subcollections, empty for top-level). Pass the REST `structuredQuery`
 * minus `from`. Null on failure.
 */
export async function runQuery(
  collectionId: string,
  query: Record<string, unknown>,
  options: { parent?: string; budget?: Budget } = {},
): Promise<FsDocument[] | null> {
  const account = await serviceAccount();
  if (!account) return null;
  const parent = options.parent ? `/${encodePath(options.parent)}` : "";
  const result = await call<Array<{ document?: { name?: string; fields?: FsFields; updateTime?: string } }>>(
    "POST",
    (acc) => `https://firestore.googleapis.com/v1/${root(acc)}${parent}:runQuery`,
    { structuredQuery: { from: [{ collectionId }], ...query } },
    options.budget,
  );
  if (!result?.data) return null;
  return result.data.filter((row) => row.document).map((row) => toDocument(account, row.document!));
}

function encodeTransform(transform: FieldTransform): Record<string, unknown> {
  if (transform.op === "serverTime") return { fieldPath: transform.field, setToServerValue: "REQUEST_TIME" };
  return { fieldPath: transform.field, [transform.op]: encodeValue(transform.value) as FsValue };
}

function encodeWrite(account: ServiceAccount, write: Write): Record<string, unknown> {
  const name = `${root(account)}/${write.path}`;
  if (write.type === "delete") return { delete: name };
  return {
    update: { name, fields: encodeFields(write.data) },
    ...(write.mask ? { updateMask: { fieldPaths: write.mask } } : {}),
    ...(write.transforms?.length ? { updateTransforms: write.transforms.map(encodeTransform) } : {}),
    ...(write.exists !== undefined ? { currentDocument: { exists: write.exists } } : {}),
  };
}

/**
 * Applies writes atomically per commit of ≤ 500 — one outbound request each.
 * Returns how many writes were committed (a failed chunk counts zero and is
 * logged; earlier chunks stay committed).
 */
export async function commitWrites(writes: Write[], options: { budget?: Budget } = {}): Promise<number> {
  if (writes.length === 0) return 0;
  const account = await serviceAccount();
  if (!account) return 0;
  let committed = 0;
  for (let i = 0; i < writes.length; i += MAX_WRITES_PER_COMMIT) {
    const chunk = writes.slice(i, i + MAX_WRITES_PER_COMMIT);
    const result = await call<{ writeResults?: unknown[] }>(
      "POST",
      (acc) => `https://firestore.googleapis.com/v1/${root(acc)}:commit`,
      { writes: chunk.map((write) => encodeWrite(account, write)) },
      options.budget,
    );
    if (result?.data) committed += chunk.length;
  }
  return committed;
}
