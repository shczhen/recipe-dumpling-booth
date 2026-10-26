# Deployment and recovery

## Local development and production

Follow the [README](../README.md) for development. For a local production server:

```sh
pnpm build
pnpm start
```

The server reads `.env.local` and binds to `127.0.0.1` by default. Local SQLite is stored under `DATA_DIR` (default `./data`). Rehearsal and formal stock are separate pools. Demo mode is restricted to rehearsal inventory. The guest and staff windows should use the same origin, browser, and profile; the current setup is designed for a TV as an extended display on that computer.

A live voice session needs internet access to Agora and the configured providers. Local rehearsal can run offline after dependencies or a portable package have been prepared.

## Portable Windows and macOS packages

```sh
pnpm build
pnpm package:portable
```

Run on the target operating system and CPU for a native package. Packaging downloads a matching Node runtime and checks its SHA256 against the Node distribution manifest. CI builds macOS arm64 and Windows x64 packages. The `releases/` output contains the application, runtime, SQLite support, sample `config.env`, restore script, and third-party notices. It excludes your `.env.local` and existing inventory.

1. Unpack into a writable directory.
2. Edit `config.env`, adding your credentials for live voice.
3. Start `Start.command` on macOS or `Start.cmd` on Windows. Keep the terminal open.
4. Open the guest window from the staff page and prepare devices there.
5. Back up `data/` before moving the folder or upgrading the application.

The package has no installer or signing. OS security prompts may require approval. Real hardware acceptance is listed in the [release checklist](release-checklist.md).

## Inventory, checkpoints, and backups

The service saves session results and stock in one transaction. A started guest receives one gift even if staff stop the session or the display disconnects. A connection that never reaches the greeting does not allocate a gift. Retries, restarts, and checkpoint recovery preserve a known result.

Staff can open the next batch **between sessions**, export a JSON backup, create checkpoints, and restore a selected checkpoint after confirming the environment. Reset and inventory edits require an operation reason. Disk write failures surface a recovery warning; fix the disk problem before relying on automatic exports.

For a full exported JSON backup, stop the local application and restore into a **new directory**:

```sh
node scripts/restore.mjs backup.json ./recovered-data
```

Then set `DATA_DIR=./recovered-data` and restart. The portable package puts `restore.mjs` beside its runtime; use `runtime/node restore.mjs …` on macOS or `runtime\node.exe restore.mjs …` on Windows. The restore tool validates seven-category inventory totals and refuses to overwrite an existing database. Do not restore monorepo experimental/legacy backups into this fresh recipe.

Do not run independent local servers against copies of the same event stock. Give each deployment its own inventory and database.

## Optional Vercel deployment

Use the repository root as the project directory. `vercel.json` builds with the Nitro Vercel preset. Set these server-side variables in the deployment:

- `DATABASE_URL`: an independent remote libSQL URL, `libsql://…` or `https://…`.
- `DATABASE_AUTH_TOKEN`: the database credential, if required by that service.
- `SESSION_SECRET`: at least 32 random characters.
- `ADMIN_PASSCODE` and `DISPLAY_PASSCODE`: two different, nonempty codes.
- The Agora and optional LLM/TTS variables from `.env.example` for live voice.

Vercel is detected automatically; `DEPLOYMENT=online` enables the same configuration elsewhere. The online pool is separate from local rehearsal/formal inventory. Browser microphone access requires HTTPS or localhost. The application refuses online startup without remote storage and the required access settings. The runtime does not create remote disk backup files; use staff JSON exports and database-provider backups.

Treat preview deployments as separate environments: use a separate database and codes. Test your intended network and region before an event; Vercel and voice providers may be unreachable from some networks. No live cloud call or Vercel deployment is part of the automated test suite.
