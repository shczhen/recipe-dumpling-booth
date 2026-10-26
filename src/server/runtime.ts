import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { readConfig } from "./config";
import { localStore, remoteStore } from "./store";
import { DumplingService } from "./service";
import { createApi } from "./api";
import { agoraGateway } from "./agora";
let api: Promise<ReturnType<typeof createApi>> | undefined;
export function getApi() {
  return (api ??= (async () => {
    const config = readConfig();
    if (config.deployment === "local")
      mkdirSync(config.dataDir, { recursive: true });
    const store =
      config.deployment === "online"
        ? remoteStore(config.databaseUrl!, config.databaseToken ?? "")
        : localStore(resolve(config.dataDir, "dumpling.sqlite"));
    const service = new DumplingService(store, config);
    await service.init(config.deployment === "local");
    return createApi(
      service,
      {
        deployment: config.deployment,
        secret: process.env.SESSION_SECRET,
        adminPasscode: process.env.ADMIN_PASSCODE,
        displayPasscode: process.env.DISPLAY_PASSCODE,
      },
      config.agoraReady ? agoraGateway() : undefined,
    );
  })());
}
