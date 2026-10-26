import {
  cp,
  mkdir,
  writeFile,
  chmod,
  mkdtemp,
  rm,
  access,
} from "node:fs/promises";
import { resolve, join, basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dependencyNotices } from "./dependency-notices.mjs";
import { execFileSync } from "node:child_process";
const platform = process.env.TARGET_PLATFORM ?? process.platform;
const arch = process.env.TARGET_ARCH ?? process.arch;
const version = process.versions.node;
if (!["darwin", "win32"].includes(platform) || !["arm64", "x64"].includes(arch))
  throw new Error("Portable targets: darwin/win32 with arm64/x64 only.");
await access(".output/server/index.mjs");
const target = resolve("releases", `dumpling-${platform}-${arch}`);
try {
  await access(target);
  throw new Error(
    `Output already exists: ${target}. Move the previous package before rebuilding.`,
  );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await mkdir(join(target, "app"), { recursive: true });
await cp(".output", join(target, "app", ".output"), { recursive: true });
await cp("scripts/restore.mjs", join(target, "restore.mjs"));
await cp("scripts/catalog.json", join(target, "catalog.json"));
await cp("scripts/launcher.mjs", join(target, "launcher.mjs"));
await cp(".env.example", join(target, "config.env"));
await cp("docs/portable.md", join(target, "README.md"));
await cp("LICENSE", join(target, "LICENSE"));
await cp("NOTICE", join(target, "NOTICE"));
await cp("THIRD_PARTY_NOTICES.md", join(target, "THIRD_PARTY_NOTICES.md"));
await cp("licenses", join(target, "licenses"), { recursive: true });
await writeFile(
  join(target, "DEPENDENCY_NOTICES.txt"),
  await dependencyNotices(),
);
await mkdir(join(target, "runtime"));
const nodePath = join(
  target,
  "runtime",
  platform === "win32" ? "node.exe" : "node",
);
{
  const name = `node-v${version}-${platform === "win32" ? "win" : platform}-${arch}`;
  const archive = `${name}.${platform === "win32" ? "zip" : "tar.gz"}`;
  const base = `https://nodejs.org/dist/v${version}`;
  const manifest = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const response = await fetch(`${base}/${archive}`);
  if (!response.ok)
    throw new Error("Could not download the target Node runtime.");
  const bytes = Buffer.from(await response.arrayBuffer());
  const expected = manifest
    .split("\n")
    .find((line) => line.trim().endsWith(` ${archive}`))
    ?.split(/\s+/)[0];
  if (
    !expected ||
    createHash("sha256").update(bytes).digest("hex") !== expected
  )
    throw new Error("Node runtime SHA256 verification failed.");
  const temp = await mkdtemp(join(tmpdir(), "dumpling-runtime-"));
  try {
    const file = join(temp, archive);
    await writeFile(file, bytes);
    if (platform === "win32") execFileSync("tar", ["-xf", file, "-C", temp]);
    else execFileSync("tar", ["-xzf", file, "-C", temp]);
    await cp(
      join(temp, name, platform === "win32" ? "node.exe" : "bin/node"),
      nodePath,
    );
    await cp(join(temp, name, "LICENSE"), join(target, "runtime", "LICENSE"));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
const mac = `#!/bin/bash
cd "$(dirname "$0")"
./runtime/node --env-file-if-exists=config.env launcher.mjs
`;
const win = [
  "@echo off",
  'cd /d "%~dp0"',
  '"%~dp0runtime\\node.exe" --env-file-if-exists=config.env launcher.mjs',
  "pause",
  "",
].join("\r\n");
if (platform === "darwin") {
  await writeFile(join(target, "Start.command"), mac);
  await chmod(join(target, "Start.command"), 0o755);
  await chmod(nodePath, 0o755);
} else await writeFile(join(target, "Start.cmd"), win);
await writeFile(
  join(target, "BUILD.json"),
  JSON.stringify(
    {
      version: "0.1.0",
      node: version,
      platform,
      arch,
      createdAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
console.log(
  `Portable package: ${target}\nIncludes Node and SQLite; excludes real credentials and inventory.`,
);

if (platform === "darwin") {
  execFileSync("tar", [
    "-czf",
    `${target}.tar.gz`,
    "-C",
    dirname(target),
    basename(target),
  ]);
} else if (process.platform === "win32") {
  execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Compress-Archive",
    "-LiteralPath",
    target,
    "-DestinationPath",
    `${target}.zip`,
  ]);
} else if (process.platform === "darwin") {
  execFileSync("ditto", ["-c", "-k", "--keepParent", target, `${target}.zip`]);
}
