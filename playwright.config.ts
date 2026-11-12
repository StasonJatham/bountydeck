import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: process.env.E2E_ORIGIN ?? "http://bossob.test",
    actionTimeout: 10000,
    launchOptions: {
      args: ["--host-resolver-rules=MAP bossob.test 127.0.0.1"],
      ...(process.env.E2E_USE_SYSTEM_CHROME === "1"
        ? { channel: "chrome" }
        : {}),
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
