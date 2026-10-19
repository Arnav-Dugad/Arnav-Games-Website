import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const DETAIL_ROUTE = "/game/cyberpunk-2077-1091500";

const PUBLIC_ROUTES = [
  "/",
  "/upcoming",
  "/upcoming?window=tba",
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
] as const;

async function expectHealthyImages(page: Page) {
  await page.evaluate(async () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
    await new Promise((resolve) => setTimeout(resolve, 750));
  });
  const broken = await page.locator("img").evaluateAll((elements) => (elements as HTMLImageElement[])
    .filter((image) => image.complete && image.naturalWidth === 0)
    .map((image) => ({ src: image.currentSrc || image.src, alt: image.alt })));
  expect(broken, `Broken rendered images: ${JSON.stringify(broken)}`).toEqual([]);
}

for (const route of PUBLIC_ROUTES) {
  test(`${route} renders its complete semantic shell`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("main#main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Skip to content" })).toHaveCount(1);
    await expect(page).toHaveTitle(/Arnav Games/);
    await expectHealthyImages(page);
    expect(pageErrors).toEqual([]);
  });
}

test("global search traps and restores keyboard focus", async ({ page }) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Search the complete database" }).first();
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Search all of Arnav Games" });
  await expect(dialog).toBeVisible();
  await expect(page.locator("#global-search")).toBeFocused();

  for (let index = 0; index < 12; index++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((panel) => panel.contains(document.activeElement))).toBe(true);
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("mobile navigation remains thumb-reachable and opens search", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
    deviceScaleFactor: 2.75,
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    await page.goto("/");

    const mobileNav = page.getByRole("navigation", { name: "Primary" }).last();
    await expect(mobileNav).toBeVisible();
    await expect(mobileNav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    await mobileNav.getByRole("button", { name: "Search the complete database" }).click();
    await expect(page.getByRole("dialog", { name: "Search all of Arnav Games" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Search all of Arnav Games" })).toBeHidden();
  } finally {
    await context.close();
  }
});

test("premium layouts stay inside a 320px mobile viewport", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 720 },
    userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  try {
    for (const route of ["/stats", "/search?q=cyberpuk", "/browse?search=elden%20rng", "/upcoming", DETAIL_ROUTE]) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        page: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        offenders: [...document.body.querySelectorAll<HTMLElement>("*")]
          .map((element) => {
            const box = element.getBoundingClientRect();
            return {
              tag: element.tagName.toLowerCase(),
              className: typeof element.className === "string" ? element.className.slice(0, 140) : "",
              left: Math.round(box.left),
              right: Math.round(box.right),
              width: Math.round(box.width),
            };
          })
          .filter((box) => box.left < -1 || box.right > document.documentElement.clientWidth + 1)
          .slice(0, 8),
      }));
      expect(overflow.page, `${route} document overflowed: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.viewport + 1);
      expect(overflow.body, `${route} body overflowed: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.viewport + 1);
    }
  } finally {
    await context.close();
  }
});

test("typo search returns the intended game before entity detours", async ({ request }) => {
  const response = await request.get("/api/search?q=cyberpuk");
  expect(response.ok()).toBe(true);
  const payload = await response.json() as { source?: string; hits?: { kind: string; name: string }[] };
  if (payload.source === "igdb") {
    expect(payload.hits?.some((hit) => hit.kind === "game" && /cyberpunk/i.test(hit.name))).toBe(true);
  }
});

test("upcoming calendar never renders an exact past release", async ({ page }) => {
  await page.goto("/upcoming?window=all&all=1", { waitUntil: "domcontentloaded" });
  const dates = await page.locator("[data-release-date]").evaluateAll((rows) => rows
    .map((row) => row.getAttribute("data-release-date"))
    .filter((date): date is string => Boolean(date)));
  const today = new Date().toISOString().slice(0, 10);
  expect(dates.filter((date) => date < today), `Past releases leaked into Upcoming: ${dates.filter((date) => date < today).join(", ")}`).toEqual([]);
});

test("very long search names stay inside a narrow result panel", async ({ page }) => {
  await page.route("**/api/search?q=longname", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ hits: [{
      kind: "game",
      id: 999999,
      slug: "long-name-test",
      name: "AReallyLongUnbrokenGameTitleThatShouldNeverEverEscapeTheSearchResultContainerEvenOnTheSmallestSupportedPhone",
      subtitle: "Responsive regression fixture",
      image: null,
      released: null,
      releaseWindow: null,
      tba: true,
    }] }),
  }));
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.getByRole("button", { name: "Search the complete database" }).first().click();
  await page.locator("#global-search").fill("longname");
  await expect(page.getByText("AReallyLongUnbrokenGameTitleThatShouldNeverEverEscapeTheSearchResultContainerEvenOnTheSmallestSupportedPhone")).toBeVisible();
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  expect(overflow.page).toBeLessThanOrEqual(overflow.viewport + 1);
});

for (const route of ["/", "/stats", DETAIL_ROUTE, "/login"] as const) {
  test(`${route} has no serious automated accessibility violations`, async ({ page }) => {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(750);
    const results = await new AxeBuilder({ page })
      // Contrast needs real visual review because translucent artwork changes
      // the computed background; every structural WCAG rule still runs here.
      .disableRules(["color-contrast"])
      .analyze();
    const blocking = results.violations.filter((violation) => violation.impact === "critical" || violation.impact === "serious");
    expect(blocking.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.flatMap((node) => node.target),
    }))).toEqual([]);
  });
}
