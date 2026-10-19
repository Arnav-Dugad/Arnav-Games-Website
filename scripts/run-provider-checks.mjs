import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Node 24 can report ENOMEM from os.userInfo() in restricted Windows runners.
// tsx only needs the username to name a temporary directory, so provide a
// deterministic local fallback without weakening the checks themselves.
try {
  os.userInfo();
} catch {
  os.userInfo = () => ({ username: "arnav-games-checks" });
}

const require = createRequire(import.meta.url);
const { require: requireTs } = require("tsx/cjs/api");
requireTs("./check-providers.ts", fileURLToPath(import.meta.url));
