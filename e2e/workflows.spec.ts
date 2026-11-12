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
  await changeStatus(triager, "validated", "high");
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
  await manager.goto("/admin");
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
