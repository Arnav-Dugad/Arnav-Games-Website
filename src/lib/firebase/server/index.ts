/**
 * Server-only Firestore access (REST + service account). Never import this
 * from a client component: it reads `FIREBASE_SERVICE_ACCOUNT`.
 */
export {
  batchGetDocuments,
  commitWrites,
  firestoreConfigured,
  getDocument,
  runQuery,
  MAX_WRITES_PER_COMMIT,
  type Budget,
  type FieldTransform,
  type FsDocument,
  type Write,
} from "./firestore";
export { asNumber, asRecord, fieldPath } from "./values";
