import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
process.chdir(fileURLToPath(new URL(".", import.meta.url)));
process.env.HOST = "127.0.0.1";
process.env.PORT ??= "3000";
process.env.DATA_DIR = resolve(process.env.DATA_DIR || "data");
const url = `http://127.0.0.1:${process.env.PORT}/admin`;
try {
  const running = await fetch(url, { signal: AbortSignal.timeout(500) })
    .then(() => true)
    .catch(() => false);
  if (running)
    throw new Error(
      "The port is in use. Close the existing booth server first.",
    );
  await import("./app/.output/server/index.mjs");
  for (let attempt = 0; attempt < 40; attempt++) {
    const ready = await fetch(url, { signal: AbortSignal.timeout(500) })
      .then((response) => response.ok)
      .catch(() => false);
    if (ready) {
      console.log(
        `Staff controls: ${url}\nKeep this terminal open. Press Ctrl+C to stop.`,
      );
      if (process.env.OPEN_BROWSER !== "false") {
        const args =
          process.platform === "win32" ? ["/c", "start", "", url] : [url];
        spawn(process.platform === "win32" ? "cmd" : "open", args, {
          stdio: "ignore",
          windowsHide: true,
        }).on("error", () => {});
      }
      break;
    }
    if (attempt === 39)
      throw new Error(
        "Server startup timed out. Check the configuration and port.",
      );
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
