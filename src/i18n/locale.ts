import { zh, type Message } from "./messages";
import type { Language, Mode, Status } from "../shared/model";

export const defaultLocale: Language = "en";
export const localeStorageKey = "dumpling.ui-locale.v1";
export const localeTag = (locale: Language) =>
  locale === "zh" ? "zh-CN" : "en-US";
export const parseLocale = (value: unknown): Language =>
  value === "zh" ? "zh" : defaultLocale;
export function translate(
  locale: Language,
  message: Message,
  values: Record<string, string | number> = {},
) {
  const template: string = locale === "zh" ? zh[message] : message;
  return template.replace(/\{(\w+)\}/g, (token, key: string) =>
    Object.hasOwn(values, key) ? String(values[key]) : token,
  );
}

// Older API / SDK adapters still return Chinese diagnostics. Resolve them at
// render time, so changing UI locale never restarts a voice or device effect.
const legacyMessages = new Map(
  Object.entries(zh).map(([en, ch]) => [ch as string, en as Message]),
);
export function translateText(locale: Language, value: string): string {
  if (Object.hasOwn(zh, value)) return translate(locale, value as Message);
  const message = legacyMessages.get(value);
  if (message) return translate(locale, message);
  const voice = value.match(
    /^(.+) 语音服务异常(?:，代码 (-?\d+))?，请工作人员检查配置。$/u,
  );
  if (voice)
    return translate(
      locale,
      "There's a problem with {module}{code}. Ask a staff member to check the voice settings.",
      {
        module: voice[1],
        code: voice[2]
          ? translate(locale, " (code {code})", { code: voice[2] })
          : "",
      },
    );
  return value;
}

const modes = {
  rehearsal: "Rehearsal",
  formal: "Live",
  online: "Online test",
} as const;
const statuses = {
  connecting: "Waiting for the greeting",
  chatting: "Chatting",
  announcing: "Announcing the gift",
  gifted: "Gift revealed · Keep chatting",
  completed: "Completed",
  cancelled: "Cancelled",
} as const;
export const modeLabel = (locale: Language, mode: Mode) =>
  translate(locale, modes[mode]);
export const statusLabel = (locale: Language, status: Status) =>
  translate(locale, statuses[status]);
