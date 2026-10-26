import { defaultGifts, type Gift } from "../shared/model";
const requiredAgora = [
  "AGORA_APP_ID",
  "AGORA_APP_CERTIFICATE",
  "AGORA_VOICE_ID",
] as const;
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const deployment =
    env.VERCEL || env.DEPLOYMENT === "online" ? "online" : "local";
  const llmFields = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL"] as const;
  const wantsByok = llmFields.some((key) => !!env[key]);
  const agoraReady =
    env.AGORA_ENABLED === "true" &&
    requiredAgora.every((key) => !!env[key]) &&
    (!wantsByok || llmFields.every((key) => !!env[key]));
  const demoSeconds = Number(env.DEMO_SECONDS ?? 120);
  if (!Number.isInteger(demoSeconds) || demoSeconds < 5 || demoSeconds > 120)
    throw new Error("DEMO_SECONDS 必须为 5–120 的整数");
  let gifts: Gift[] = defaultGifts;
  if (env.GIFTS_JSON) {
    gifts = JSON.parse(env.GIFTS_JSON);
    if (
      !Array.isArray(gifts) ||
      gifts.length !== 7 ||
      gifts.some(
        (g) =>
          !g ||
          !["zh", "en"].every(
            (k) =>
              typeof g[k as keyof Gift] === "string" &&
              g[k as keyof Gift].length > 0 &&
              g[k as keyof Gift].length <= 60,
          ),
      )
    )
      throw new Error(
        "GIFTS_JSON must contain seven gifts, each with English and Chinese names.",
      );
  }
  if (
    deployment === "online" &&
    !env.DATABASE_URL?.startsWith("libsql://") &&
    !env.DATABASE_URL?.startsWith("https://")
  )
    throw new Error("线上必须配置独立远程 DATABASE_URL");
  if (
    deployment === "online" &&
    (!env.SESSION_SECRET ||
      env.SESSION_SECRET.length < 32 ||
      !env.ADMIN_PASSCODE ||
      !env.DISPLAY_PASSCODE ||
      env.ADMIN_PASSCODE === env.DISPLAY_PASSCODE)
  )
    throw new Error(
      "线上需配置不同的管理/体验口令及至少 32 字符 SESSION_SECRET",
    );
  return {
    deployment,
    agoraReady,
    demoSeconds,
    gifts,
    databaseUrl: env.DATABASE_URL,
    databaseToken: env.DATABASE_AUTH_TOKEN,
    dataDir: env.DATA_DIR ?? "./data",
  } as const;
}
