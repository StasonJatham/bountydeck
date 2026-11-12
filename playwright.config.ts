import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_ORIGIN ?? "http://bountydeck.test";
const { hostname } = new URL(baseURL);

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL,
    actionTimeout: 10000,
    launchOptions: {
      args: hostname.endsWith(".test")
        ? [`--host-resolver-rules=MAP ${hostname} 127.0.0.1`]
        : [],
      ...(process.env.E2E_USE_SYSTEM_CHROME === "1"
        ? { channel: "chrome" }
        : {}),
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
