import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outputRoot = process.env.DAYMARK_QA_RUN_DIR
  ? path.resolve(process.env.DAYMARK_QA_RUN_DIR, "playwright")
  : path.resolve(repoRoot, "work", "qa", "playwright-latest");

export default defineConfig({
  testDir: path.join(import.meta.dirname, "e2e"),
  testMatch: "**/*.pw.ts",
  outputDir: path.join(outputRoot, "artifacts"),
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [
    ["line"],
    ["html", { outputFolder: path.join(outputRoot, "report"), open: "never" }],
    ["json", { outputFile: path.join(outputRoot, "results.json") }],
  ],
  use: {
    ...devices["Desktop Edge"],
    channel: "msedge",
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
    reducedMotion: "reduce",
  },
  webServer: {
    command: "pnpm dev",
    cwd: repoRoot,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_ENABLE_DEMO_SEED: "true",
    },
  },
});
