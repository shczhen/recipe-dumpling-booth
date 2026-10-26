import { defineConfig } from "@playwright/test";
const preview = process.env.DUMPLING_UI_URL;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: preview ?? "http://127.0.0.1:3130",
    viewport: { width: 1672, height: 941 },
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
      ],
    },
  },
  webServer: preview
    ? undefined
    : {
        command: "pnpm dev --port 3130",
        url: "http://127.0.0.1:3130",
        reuseExistingServer: false,
        env: {
          AGORA_ENABLED: "false",
          DATA_DIR: "./data/ui-tests",
          DEMO_SECONDS: "120",
        },
        timeout: 60000,
      },
});
