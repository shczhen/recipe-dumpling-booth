import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Use pnpm's installed production graph, then include package-provided notices.
// Do not emit machine-specific node_modules paths into the distribution.
export async function dependencyNotices() {
  const graph = JSON.parse(
    execSync("pnpm licenses list --prod --json", {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  const packages = Object.values(graph)
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name));
  const sections = [];
  for (const entry of packages) {
    const notices = new Set();
    for (const directory of entry.paths) {
      for (const file of await readdir(directory)) {
        if (/^(licen[cs]e|copying|notice)([._-]|$)/i.test(file)) {
          try {
            notices.add(await readFile(join(directory, file), "utf8"));
          } catch (error) {
            if (error.code !== "EISDIR") throw error;
          }
        }
      }
    }
    sections.push(
      `${entry.name} ${entry.versions.join(", ")}\nDeclared license: ${entry.license}\n${[...notices].join("\n\n") || "No root license text supplied by this package; consult its publisher before redistribution."}`,
    );
  }
  return `Installed production dependencies. Each package retains its own license.\nThis report does not license the application itself.\n\n${sections.join("\n\n---\n\n")}\n`;
}
