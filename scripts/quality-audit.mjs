const BASE_URL = process.env.QUALITY_BASE_URL ?? "http://127.0.0.1:3137";
const REQUIRE_PROVIDER = process.env.QUALITY_REQUIRE_PROVIDER === "1";
const REQUEST_TIMEOUT_MS = 45_000;
const DETAIL_ROUTE = REQUIRE_PROVIDER ? "/game/cyberpunk-2077" : "/game/cyberpunk-2077-1091500";

const PAGE_ROUTES = [
  "/",
  "/upcoming",
  "/browse",
  "/stats",
  "/genres",
  "/platforms",
  "/studios",
  "/franchises",
  "/search?q=cyberpunk",
  DETAIL_ROUTE,
  "/login",
  "/signup",
  "/notifications",
  "/library",
  "/watchlist",
  "/settings",
  "/profile",
];

const failures = [];
const pageMarkup = new Map();

function pass(label) {
  console.log(`  ok   ${label}`);
}

function fail(label, detail) {
  failures.push(`${label}: ${detail}`);
  console.error(`  FAIL ${label}\n       ${detail}`);
}

function check(label, condition, detail) {
  if (condition) pass(label);
  else fail(label, detail);
}

async function request(path, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(new URL(path, BASE_URL), {
      redirect: "follow",
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": "ArnavGames-quality-audit/1.0", ...init?.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await request("/");
      if (response.ok) return;
    } catch {
      // The production server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Production server did not become ready at ${BASE_URL}`);
}

function decodeAttribute(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'");
}

function attributes(html, tag, attribute) {
  const tags = html.match(new RegExp(`<${tag}\\b[^>]*>`, "gi")) ?? [];
  const matcher = new RegExp(`\\s${attribute}=(?:"([^"]*)"|'([^']*)')`, "i");
  return tags.flatMap((entry) => {
    const match = entry.match(matcher);
    return match ? [decodeAttribute(match[1] ?? match[2] ?? "")] : [];
  });
}

function tagCount(html, tag) {
  return (html.match(new RegExp(`<${tag}\\b`, "gi")) ?? []).length;
}

function titleOf(html) {
  const titles = [...html.matchAll(/<title>([^<]+)<\/title>/gi)]
    .map((match) => decodeAttribute(match[1]?.trim() ?? ""));
  return titles.find((title) => /Arnav Games/i.test(title)) ?? titles.at(-1) ?? "";
}

function badTarget(value) {
  return value.trim() === "" || /(?:^|[/%])(undefined|null)(?:$|[/?#])|%5Bobject(?:%20|\+)Object%5D/i.test(value);
}

async function auditPages() {
  console.log("\nProduction pages");
  for (const path of PAGE_ROUTES) {
    try {
      const response = await request(path);
      const html = await response.text();
      pageMarkup.set(path, html);
      check(`${path} returns HTML`, response.status === 200 && response.headers.get("content-type")?.includes("text/html") === true, `status ${response.status}, content-type ${response.headers.get("content-type")}`);
      check(`${path} has one main landmark`, tagCount(html, "main") === 1 && /<main\b[^>]*\bid="main"/i.test(html), `found ${tagCount(html, "main")} main elements`);
      check(`${path} has a descriptive title`, titleOf(html).length >= 8, `title was "${titleOf(html)}"`);
      check(`${path} declares English`, /<html\b[^>]*\blang="en"/i.test(html), "missing html lang=en");
      check(`${path} keeps skip navigation`, /<a\b[^>]*\bhref="#main"/i.test(html), "missing skip-to-content link");
      check(`${path} has no server error shell`, !/__next_error__|Application error: a server-side exception/i.test(html), "Next.js rendered an error boundary");

      const anchors = attributes(html, "a", "href");
      const sources = [...attributes(html, "img", "src"), ...attributes(html, "script", "src")];
      check(`${path} has no malformed link target`, !anchors.some(badTarget), anchors.find(badTarget) ?? "malformed href");
      check(`${path} has no malformed asset target`, !sources.some(badTarget), sources.find(badTarget) ?? "malformed src");

      const images = html.match(/<img\b[^>]*>/gi) ?? [];
      check(`${path} images expose alt text`, images.every((image) => /\salt=(?:"[^"]*"|'[^']*')/i.test(image)), `${images.filter((image) => !/\salt=(?:"[^"]*"|'[^']*')/i.test(image)).length} image(s) lacked alt`);
    } catch (error) {
      fail(`${path} request`, error instanceof Error ? error.message : String(error));
    }
  }

  const titles = PAGE_ROUTES.map((path) => [path, titleOf(pageMarkup.get(path) ?? "")]);
  const duplicates = titles.filter(([, title], index) => title && titles.findIndex(([, candidate]) => candidate === title) !== index);
  check("route titles are unique", duplicates.length === 0, duplicates.map(([path, title]) => `${path}: ${title}`).join(", "));
}

function internalTargets() {
  const base = new URL(BASE_URL);
  const targets = new Map();
  for (const html of pageMarkup.values()) {
    for (const href of attributes(html, "a", "href")) {
      if (href.startsWith("#") || /^(?:mailto:|tel:|javascript:)/i.test(href)) continue;
      try {
        const target = new URL(href, base);
        if (target.origin !== base.origin || target.pathname.startsWith("/_next") || target.pathname.startsWith("/api/")) continue;
        target.hash = "";
        targets.set(`${target.pathname}${target.search}`, target);
      } catch {
        fail("link URL parsing", href);
      }
    }
  }

  const dynamicCounts = new Map();
  return [...targets.values()].filter((target) => {
    const kind = target.pathname.match(/^\/(game|studio|franchise|character)\//)?.[1];
    if (!kind) return true;
    const count = dynamicCounts.get(kind) ?? 0;
    dynamicCounts.set(kind, count + 1);
    return count < 4;
  });
}

async function mapWithLimit(items, limit, worker) {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

async function auditLinksAndAssets() {
  console.log("\nInternal navigation");
  const links = internalTargets();
  let goodLinks = 0;
  await mapWithLimit(links, 6, async (target) => {
    try {
      const response = await request(target.href, { method: "HEAD" });
      if (response.status >= 200 && response.status < 400) goodLinks++;
      else fail("internal link", `${target.pathname}${target.search} returned ${response.status}`);
    } catch (error) {
      fail("internal link", `${target.pathname}${target.search}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  check("rendered internal links resolve", goodLinks === links.length, `${goodLinks}/${links.length} healthy`);

  console.log("\nBuilt assets");
  const assets = new Set(["/icon.svg"]);
  for (const html of pageMarkup.values()) {
    for (const source of [...attributes(html, "script", "src"), ...attributes(html, "link", "href")]) {
      if (source.startsWith("/_next/static/")) assets.add(source);
    }
  }
  let goodAssets = 0;
  await mapWithLimit([...assets], 8, async (asset) => {
    try {
      const response = await request(asset, { method: "HEAD" });
      if (response.ok) goodAssets++;
      else fail("built asset", `${asset} returned ${response.status}`);
    } catch (error) {
      fail("built asset", `${asset}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
  check("referenced built assets resolve", goodAssets === assets.size, `${goodAssets}/${assets.size} healthy`);
}

async function json(path) {
  const response = await request(path);
  const body = await response.json().catch(() => null);
  return { response, body };
}

function recordOf(value) {
  return value && typeof value === "object" ? value : {};
}

async function auditApis() {
  console.log("\nAPI contracts");

  const health = await json("/api/health");
  const healthBody = recordOf(health.body);
  const healthShape = typeof healthBody.ok === "boolean" && typeof healthBody.igdb === "object" && typeof healthBody.checkedAt === "string";
  check("health diagnostics are structured", healthShape && [200, 503].includes(health.response.status), `status ${health.response.status}`);
  if (REQUIRE_PROVIDER) check("IGDB is live", health.response.status === 200 && healthBody.ok === true, JSON.stringify(healthBody.igdb));

  const search = await json("/api/search?q=cyberpunk");
  const searchBody = recordOf(search.body);
  check("universal search contract", search.response.status === 200 && Array.isArray(searchBody.hits), `status ${search.response.status}`);
  if (REQUIRE_PROVIDER) {
    const typoSearch = await json("/api/search?q=cybrpunk");
    const typoBody = recordOf(typoSearch.body);
    const recovered = Array.isArray(typoBody.hits) && typoBody.hits.some((hit) => /cyberpunk/i.test(String(hit?.name ?? "")));
    check("typo-tolerant IGDB search recovers Cyberpunk", typoSearch.response.status === 200 && recovered, JSON.stringify(typoBody));
  }

  const recommendations = await json("/api/recommendations?genres=12&limit=4");
  const recommendationsBody = recordOf(recommendations.body);
  check("recommendation contract", recommendations.response.status === 200 && Array.isArray(recommendationsBody.results) && typeof recommendationsBody.personalised === "boolean", `status ${recommendations.response.status}`);

}

async function main() {
  console.log(`Arnav Games production quality audit — ${BASE_URL}`);
  await waitForServer();
  await auditPages();
  await auditLinksAndAssets();
  await auditApis();

  if (failures.length > 0) {
    console.error(`\n${failures.length} quality check${failures.length === 1 ? "" : "s"} failed:`);
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log("\nAll production quality checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
