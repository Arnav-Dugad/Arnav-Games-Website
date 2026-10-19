/**
 * Firestore REST typed values ⇄ plain JS, and field-path quoting.
 *
 * The REST API wraps every value in a one-key object naming its type
 * (`{ integerValue: "3" }`, `{ mapValue: { fields: … } }`). These helpers are
 * the only place that knows the wire shape, so the data modules deal in plain
 * numbers, strings, arrays and maps. Pure — no network, no Next, no Workers
 * APIs — so `scripts/check-providers.ts` can pin the round trip down.
 *
 * Deliberate narrowings, because nothing this app stores needs more:
 *  - Integers decode to `number`. Every integer we store (unix seconds,
 *    minor-unit prices, counts) is far inside 2^53.
 *  - Timestamps decode to ISO strings; bytes, references and geo points are
 *    passed through as their raw REST form (we never write them).
 */

export type FsValue =
  | { nullValue: null }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { stringValue: string }
  | { timestampValue: string }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } }
  | Record<string, unknown>;

export type FsFields = Record<string, FsValue>;

export function encodeValue(value: unknown): FsValue {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    // Firestore rejects NaN/Infinity as integers; doubles carry them, but no
    // honest stat is ever non-finite, so store null instead of a poisoned value.
    if (!Number.isFinite(value)) return { nullValue: null };
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === "string") return { stringValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === "object") return { mapValue: { fields: encodeFields(value as Record<string, unknown>) } };
  throw new TypeError(`firestore: cannot encode ${typeof value}`);
}

export function encodeFields(object: Record<string, unknown>): FsFields {
  const fields: FsFields = {};
  for (const [key, value] of Object.entries(object)) {
    if (value !== undefined) fields[key] = encodeValue(value);
  }
  return fields;
}

export function decodeValue(value: FsValue | undefined): unknown {
  if (!value || typeof value !== "object") return null;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("stringValue" in value) return String(value.stringValue);
  if ("timestampValue" in value) return String(value.timestampValue);
  if ("arrayValue" in value) {
    const values = (value.arrayValue as { values?: FsValue[] } | undefined)?.values ?? [];
    return values.map(decodeValue);
  }
  if ("mapValue" in value) {
    return decodeFields((value.mapValue as { fields?: FsFields } | undefined)?.fields);
  }
  return value;
}

export function decodeFields(fields: FsFields | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields ?? {})) out[key] = decodeValue(value);
  return out;
}

const SIMPLE_SEGMENT = /^[A-Za-z_][A-Za-z_0-9]*$/;

/**
 * A field path from raw segments, quoting any segment that isn't a plain
 * identifier. Our map keys are numeric ids, unix hours, ISO days and release
 * windows ("Q4 2026"), all of which need backticks in `updateMask`,
 * `mask.fieldPaths` and transforms; quoting in one place keeps that
 * impossible to get wrong at call sites.
 */
export function fieldPath(...segments: Array<string | number>): string {
  return segments
    .map((segment) => {
      const text = String(segment);
      return SIMPLE_SEGMENT.test(text) ? text : `\`${text.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``;
    })
    .join(".");
}

/** Reads a decoded map field as a record, tolerating absent or wrong-typed data. */
export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A finite number or null — stored stats are only trusted after this check. */
export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
