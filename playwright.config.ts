import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL: "http://localhost:3210",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: "npm run build && npm run start -- -p 3210",
    url: "http://localhost:3210",
    timeout: 300_000,
    reuseExistingServer: false,
    // Blank values win over .env.local (Next never overrides an existing
    // process.env entry), so the run uses local storage and no AI provider.
    env: { BLOB_READ_WRITE_TOKEN: "", GEMINI_API_KEY: "", GROQ_API_KEY: "", OPEN_ROUTER_API_KEY: "", OPENROUTER_API_KEY: "" },
  },
});
