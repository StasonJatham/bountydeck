import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";

const program = "00000000-0000-4000-8000-000000000011";
const password = () =>
  process.env.E2E_PASSWORD ??
  readFileSync("secrets/test_user_password", "utf8").trim();

async function login(
  browser: Browser,
  baseURL: string | undefined,
  username: string,
  mobile = false,
) {
  const page = await browser.newPage({
    baseURL,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
  });
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: /sign in with company account/i })
    .click();
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password());
  await page.locator("#kc-login").click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  return page;
}

async function changeStatus(page: Page, status: string, severity?: string) {
  await page.getByLabel("Next status").selectOption(status);
  if (severity)
    await page.getByLabel("Validated severity").selectOption(severity);
  await page.getByRole("button", { name: "Update report" }).click();
  await expect(page.locator("main > p").first()).toContainText(
    status.replaceAll("_", " "),
  );
}

test("researcher submits evidence, reviewer validates, outsider is denied", async ({
  browser,
  baseURL,
}, info) => {
  const researcher = await login(browser, baseURL, "local-researcher", true);
  await researcher.goto(`/programs/${program}`);
  const pointPolicy = await researcher
    .getByText(/^high · \d+ points$/)
    .innerText();
  const award = Number(pointPolicy.match(/\d+/)?.[0]);
  const title = `Browser acceptance ${randomUUID()}`;
  for (const [label, value] of Object.entries({
    Title: title,
    "Weakness (e.g. CWE-200)": "CWE-200",
    Description: "Synthetic confidential report",
    "Reproduction steps": "Inspect the mock result",
    "Proof of concept": "Synthetic example only",
    Impact: "Unexpected visibility",
  })) {
    await researcher.getByLabel(label, { exact: true }).fill(value);
  }
  await researcher.getByRole("button", { name: "Submit report" }).click();
  await expect(researcher.getByRole("heading", { name: title })).toBeVisible();
  const report = new URL(researcher.url()).pathname;
  await researcher.locator('input[type="file"]').setInputFiles({
    name: "evidence.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Synthetic evidence"),
  });
  await researcher.getByRole("button", { name: "Upload", exact: true }).click();
  const link = researcher.getByRole("link", { name: "evidence.txt" });
  await expect(link).toBeVisible();
  const evidence = (await link.getAttribute("href"))!;
  expect(
    await researcher.evaluate(
      async (url) => (await fetch(url)).text(),
      evidence,
    ),
  ).toBe("Synthetic evidence");
  expect(
    await researcher.evaluate(() => document.documentElement.scrollWidth),
  ).toBe(390);
  await researcher.evaluate(() => window.scrollTo(0, 0));
  await researcher.screenshot({
    path: info.outputPath("researcher-mobile.png"),
    fullPage: true,
  });

  const triager = await login(browser, baseURL, "local-triager");
  await triager.goto(report);
  await triager.getByLabel("Add a comment").fill("Confidential triage note");
  await triager.getByLabel("Internal note").check();
  await triager.getByRole("button", { name: "Post comment" }).click();
  await expect(triager.getByText("Confidential triage note")).toBeVisible();
  await triager.getByLabel("Add a comment").fill("Thank you for the report.");
  await triager.getByRole("button", { name: "Post comment" }).click();
  await expect(triager.getByText("Thank you for the report.")).toBeVisible();
  await changeStatus(triager, "triage");
  await triager
    .getByLabel("CVSS 4.0 vector")
    .fill("CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:H/SI:H/SA:H");
  await changeStatus(triager, "validated", "high");
  await expect(triager.getByText(/CVSS 10\.0/)).toBeVisible();
  await expect(
    triager
      .getByRole("heading", { name: "Points history" })
      .locator("..")
      .getByText(String(award), { exact: true }),
  ).toBeVisible();
  await triager.screenshot({
    path: info.outputPath("triage-desktop.png"),
    fullPage: true,
  });
  await changeStatus(triager, "remediation");
  await changeStatus(triager, "retesting");
  await changeStatus(triager, "resolved");

  await researcher.reload();
  await expect(researcher.getByText("Confidential triage note")).toHaveCount(0);
  await expect(researcher.getByText("Thank you for the report.")).toBeVisible();
  const exportPath = (await researcher
    .getByRole("link", { name: "Export report" })
    .getAttribute("href"))!;
  const exported = await researcher.evaluate(
    async (url) => (await fetch(url)).text(),
    exportPath,
  );
  expect(exported).toContain("Thank you for the report.");
  expect(exported).not.toContain("Confidential triage note");
  await researcher.goto("/profile");
  await expect(researcher.getByText("Report validated").first()).toBeVisible();

  const outsider = await login(browser, baseURL, "local-outsider");
  expect((await outsider.goto(report))?.status()).toBe(404);
  expect(
    await outsider.evaluate(async (url) => (await fetch(url)).status, evidence),
  ).toBe(404);
  expect(
    await outsider.evaluate(
      async (url) => (await fetch(url)).status,
      exportPath,
    ),
  ).toBe(404);
  await researcher.getByRole("button", { name: "Account menu" }).click();
  await researcher.getByRole("button", { name: "Sign out" }).click();
  await expect(
    researcher.getByRole("heading", {
      name: "Find vulnerabilities. Earn recognition.",
    }),
  ).toBeVisible();
  await researcher.goto("/dashboard");
  await expect(
    researcher.getByRole("button", { name: /sign in with company account/i }),
  ).toBeVisible();
  await researcher.close();
  await triager.close();
  await outsider.close();
});

test("organization and program administration enforce role boundaries", async ({
  browser,
  baseURL,
}, info) => {
  const suffix = randomUUID().slice(0, 8);
  const admin = await login(browser, baseURL, "local-platform-admin");
  await admin.goto("/admin");
  const globalRankings = admin.getByRole("checkbox", {
    name: "Show global leaderboard",
  });
  await globalRankings.uncheck();
  await admin.getByRole("button", { name: "Save platform settings" }).click();
  await expect(
    admin.getByText("platform.settings_updated").first(),
  ).toBeVisible();
  try {
    await admin.goto("/leaderboard");
    await expect(
      admin.getByText(
        "The platform administrator has disabled global rankings.",
      ),
    ).toBeVisible();
  } finally {
    await admin.goto("/admin");
    await globalRankings.check();
    await Promise.all([
      admin.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/admin",
      ),
      admin.getByRole("button", { name: "Save platform settings" }).click(),
    ]);
    await admin.goto("/admin");
  }
  const createOrg = admin.locator("form").filter({
    has: admin.getByRole("heading", { name: "Create organization" }),
  });
  await createOrg.getByLabel("Name", { exact: true }).fill(`QA Unit ${suffix}`);
  await createOrg.getByLabel("Slug").fill(`qa-${suffix}`);
  await createOrg.getByRole("button", { name: "Create organization" }).click();
  await expect(
    admin.getByRole("option", { name: `QA Unit ${suffix}` }).first(),
  ).toBeAttached();
  const orgId = await admin
    .getByRole("option", { name: `QA Unit ${suffix}` })
    .first()
    .getAttribute("value");

  const manager = await login(browser, baseURL, "local-manager");
  await manager.goto("/profile");
  const managerId = (await manager.getByText(/^User ID /).innerText()).replace(
    "User ID ",
    "",
  );
  const grant = admin.locator("form").filter({
    has: admin.getByRole("heading", { name: "Organization access" }),
  });
  await grant.getByLabel("Organization").selectOption(orgId!);
  await grant.getByLabel("User ID").fill(managerId);
  await grant.getByLabel("Role").selectOption("admin");
  await grant.getByRole("button", { name: "Grant", exact: true }).click();
  await expect(
    admin.getByText("organization.role_grant").first(),
  ).toBeVisible();
  await manager.goto("/organizations");
  const createProgram = manager
    .locator("form")
    .filter({ has: manager.getByRole("heading", { name: "Create program" }) });
  await createProgram.getByLabel("Organization").selectOption(orgId!);
  await createProgram
    .getByLabel("Name", { exact: true })
    .fill(`QA Program ${suffix}`);
  await createProgram.getByLabel("Slug").fill(`qa-program-${suffix}`);
  await createProgram.getByRole("button", { name: "Create program" }).click();
  await expect(
    manager.getByRole("heading", { name: `Manage QA Program ${suffix}` }),
  ).toBeVisible();
  const managePath = new URL(manager.url()).pathname;
  await manager
    .locator("form")
    .filter({ has: manager.getByRole("heading", { name: "Add to scope" }) })
    .getByLabel("Asset name")
    .fill("Synthetic asset");
  await manager.getByRole("button", { name: "Add asset" }).click();
  await expect(manager.getByText("Synthetic asset · In scope")).toBeVisible();
  await manager.getByLabel("Testing rules").fill("Use synthetic accounts.");
  await manager
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("published");
  await manager.getByRole("button", { name: "Save settings" }).click();
  await expect(
    manager.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("published");
  await manager.getByRole("link", { name: "Notification settings" }).click();
  await manager
    .getByLabel("Email address or webhook URL")
    .fill("security@example.invalid");
  await manager.getByRole("button", { name: "Add channel" }).click();
  await expect(manager.getByText("security@example.invalid")).toBeVisible();
  await manager.getByRole("button", { name: "Send test" }).click();
  await expect(manager.getByRole("status")).toContainText("Change saved");
  await expect(manager.getByText(/^notification\.test ·/)).toBeVisible();
  await manager.screenshot({
    path: info.outputPath("notifications-desktop.png"),
    fullPage: true,
  });

  const outsider = await login(browser, baseURL, "local-outsider");
  expect((await outsider.goto(managePath))?.status()).toBe(404);
  expect((await outsider.goto(`${managePath}/notifications`))?.status()).toBe(
    404,
  );
  await Promise.all([admin.close(), manager.close(), outsider.close()]);
});

test("SMTP and signed HTTPS notifications retry and record attempts", async ({
  browser,
  baseURL,
}) => {
  test.skip(
    process.env.E2E_NOTIFICATION_FIXTURE !== "1",
    "Requires the local notification fixture",
  );
  const recipient = "browser-notification@example.invalid";
  const endpoint = "https://notify-fixture.bossob.test:8443/report";
  const manager = await login(browser, baseURL, "local-manager");
  const settings = `/programs/${program}/manage/notifications`;
  await manager.goto(settings);
  for (const destination of [recipient, endpoint]) {
    const existing = manager
      .getByText(destination, { exact: true })
      .locator("..")
      .getByRole("button", { name: "Disable", exact: true });
    for (let remaining = await existing.count(); remaining > 0; remaining--) {
      await existing.first().click();
      await expect(existing).toHaveCount(remaining - 1);
    }
    await manager
      .getByRole("combobox", { name: "Transport" })
      .selectOption(destination === recipient ? "smtp" : "webhook");
    await manager.getByLabel("Email address or webhook URL").fill(destination);
    if (destination === endpoint) {
      const hmac = readFileSync(
        "secrets/notification_test_hmac",
        "utf8",
      ).trim();
      await manager
        .getByLabel("Webhook signing secret", { exact: false })
        .fill(hmac);
    }
    await manager.getByRole("button", { name: "Add channel" }).click();
    await expect(
      manager
        .getByText(destination, { exact: true })
        .locator("..")
        .getByRole("button", { name: "Disable", exact: true }),
    ).toBeVisible();
  }
  const researcher = await login(browser, baseURL, "local-researcher");
  await researcher.goto(`/programs/${program}`);
  const title = `Notification acceptance ${randomUUID()}`;
  for (const [label, value] of Object.entries({
    Title: title,
    "Weakness (e.g. CWE-200)": "CWE-200",
    Description: "Synthetic confidential report",
    "Reproduction steps": "Open the fixture",
    "Proof of concept": "Synthetic data",
    Impact: "Demonstrates notifications",
  })) {
    await researcher.getByLabel(label, { exact: true }).fill(value);
  }
  await researcher.getByRole("button", { name: "Submit report" }).click();
  await expect(researcher.getByRole("heading", { name: title })).toBeVisible();
  const reportNumber = (
    await researcher.locator("main > p").first().innerText()
  ).split(" · ")[0];
  const deliveries = manager
    .getByText(`report.submitted · delivered · 2 attempts · ${reportNumber}`, {
      exact: true,
    })
    .locator("..");
  await expect
    .poll(
      async () => {
        await manager.reload();
        return deliveries.count();
      },
      { timeout: 40_000, intervals: [500, 1000] },
    )
    .toBe(2);
  for (const button of await deliveries
    .getByText("Attempts", { exact: true })
    .all())
    await button.click();
  for (const result of [
    /1\. smtp transport error/,
    /2\. smtp accepted/,
    /1\. http 503/,
    /2\. http 204/,
  ]) {
    await expect(deliveries.getByText(result)).toBeVisible();
  }
  await Promise.all([manager.close(), researcher.close()]);
});

test("color theme follows the system and persists across sign-in and reload", async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const root = page.locator("html");
  await expect(page).toHaveTitle(/BountyDeck/);
  const favicon = page.locator('link[rel="icon"]').first();
  await expect(favicon).toHaveAttribute("href", /icon/);
  expect(
    await favicon.evaluate(
      async (element) => (await fetch((element as HTMLLinkElement).href)).ok,
    ),
  ).toBe(true);
  const theme = page.getByRole("combobox", { name: "Color theme" });
  await expect(theme).toHaveValue("system");
  await expect(root).toHaveCSS("background-color", "rgb(20, 20, 22)");
  await page.screenshot({
    path: info.outputPath("landing-dark.png"),
    fullPage: true,
  });

  await theme.selectOption("light");
  await expect(root).toHaveCSS("background-color", "rgb(250, 250, 249)");
  await page.reload();
  await expect(theme).toHaveValue("light");
  await expect(root).toHaveCSS("background-color", "rgb(250, 250, 249)");
  await page.screenshot({
    path: info.outputPath("landing-light.png"),
    fullPage: true,
  });

  await theme.selectOption("dark");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: /sign in with company account/i })
    .click();
  await page.locator("#username").fill("local-researcher");
  await page.locator("#password").fill(password());
  await page.locator("#kc-login").click();

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(theme).toHaveValue("dark");
  await expect(page.getByRole("banner")).toHaveCSS(
    "background-color",
    "rgb(30, 30, 34)",
  );
  await theme.selectOption("system");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveCSS("background-color", "rgb(250, 250, 249)");
});

test("German and English persist, and only platform admins can open Administration", async ({
  page,
  browser,
  baseURL,
}) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Administration" })).toHaveCount(
    0,
  );
  await page.getByRole("combobox", { name: "Language" }).selectOption("de");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(
    page.getByRole("heading", {
      name: "Sicherheitslücken finden. Anerkennung verdienen.",
    }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Sprache" })).toHaveValue(
    "de",
  );
  await page.getByRole("link", { name: "Anmelden" }).click();
  await page
    .getByRole("button", { name: "Mit Unternehmenskonto anmelden" })
    .click();
  await expect(
    page.getByRole("button", { name: "Anmelden", exact: true }),
  ).toBeVisible();
  await page.locator("#username").fill("local-researcher");
  await page.locator("#password").fill(password());
  await page.locator("#kc-login").click();
  await expect(page.getByRole("heading", { name: "Übersicht" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Hauptnavigation" });
  await expect(
    navigation.getByRole("link", { name: "Verwaltung", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: "Programme", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Programme" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Suchen" })).toBeVisible();
  expect((await page.goto("/admin"))?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { name: "Seite nicht gefunden" }),
  ).toBeVisible();
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Kontomenü" }).click();
  await page.getByRole("combobox", { name: "Sprache" }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

  const manager = await login(browser, baseURL, "local-manager");
  await expect(
    manager.getByRole("link", { name: "Administration" }),
  ).toHaveCount(0);
  await manager.getByRole("link", { name: "Organizations" }).click();
  await expect(
    manager.getByRole("heading", { name: "Organization management" }),
  ).toBeVisible();
  expect((await manager.goto("/admin"))?.status()).toBe(404);
  const admin = await login(browser, baseURL, "local-platform-admin");
  await admin.getByRole("button", { name: "Account menu" }).click();
  await admin.getByRole("combobox", { name: "Language" }).selectOption("de");
  await admin.getByRole("link", { name: "Verwaltung", exact: true }).click();
  await expect(
    admin.getByRole("heading", { name: "Verwaltung", exact: true }),
  ).toBeVisible();
  await expect(
    admin.getByRole("button", { name: "Organisation erstellen" }),
  ).toBeVisible();
  await Promise.all([manager.close(), admin.close()]);
});

test("responsive navigation is keyboard accessible and role-aware", async ({
  browser,
  baseURL,
}, info) => {
  const reviewer = await login(browser, baseURL, "local-triager");
  const sidebar = reviewer.getByRole("navigation", { name: "Main navigation" });
  const collapse = reviewer.getByRole("button", {
    name: "Collapse navigation",
  });
  const expand = reviewer.getByRole("button", { name: "Expand navigation" });
  await expect(sidebar.getByRole("link", { name: "My reports" })).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: "Triage inbox" }),
  ).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: "Administration" }),
  ).toHaveCount(0);
  await reviewer.screenshot({
    path: info.outputPath("dashboard-desktop.png"),
    fullPage: true,
  });

  await collapse.click();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(
    sidebar.getByRole("link", { name: "Triage inbox" }),
  ).toBeVisible();
  await expand.click();
  await expect(collapse).toHaveAttribute("aria-expanded", "true");

  const organization = sidebar.getByRole("combobox", { name: "Organization" });
  await organization.selectOption({ label: "Application Security" });
  await expect(reviewer).toHaveURL(
    /\/programs\?organization=00000000-0000-4000-8000-000000000001$/,
  );
  await expect(organization).toHaveValue(
    "00000000-0000-4000-8000-000000000001",
  );

  await sidebar.getByRole("link", { name: "Leaderboard" }).click();
  await expect(
    reviewer.getByRole("heading", { name: "Leaderboard" }),
  ).toBeVisible();
  await reviewer.screenshot({
    path: info.outputPath("leaderboard-desktop.png"),
    fullPage: true,
  });

  const researcher = await login(browser, baseURL, "local-researcher", true);
  const open = researcher.getByRole("button", { name: "Open navigation" });
  const drawer = researcher.getByRole("dialog", {
    name: /^(main )?navigation$/i,
  });
  await expect(drawer).toBeHidden();
  await open.focus();
  await researcher.keyboard.press("Enter");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(":focus")).toHaveCount(1);
  await expect(drawer.getByRole("link", { name: "My reports" })).toBeVisible();
  await expect(drawer.getByRole("link", { name: "Triage inbox" })).toHaveCount(
    0,
  );
  await expect(
    drawer.getByRole("link", { name: "Administration" }),
  ).toHaveCount(0);
  await researcher.screenshot({
    path: info.outputPath("navigation-mobile.png"),
  });

  await researcher.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(open).toBeFocused();
  await open.click();
  await drawer.getByRole("link", { name: "My reports" }).click();
  await expect(drawer).toBeHidden();
  await expect(
    researcher.getByRole("heading", { name: "My reports" }),
  ).toBeVisible();
  expect(
    await researcher.evaluate(() => document.documentElement.scrollWidth),
  ).toBe(390);

  await Promise.all([reviewer.close(), researcher.close()]);
});
