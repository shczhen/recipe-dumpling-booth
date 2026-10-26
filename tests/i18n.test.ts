import { expect, test } from "vitest";
import {
  defaultLocale,
  localeTag,
  modeLabel,
  parseLocale,
  statusLabel,
  translate,
  translateText,
} from "../src/i18n/locale";
import { zh } from "../src/i18n/messages";
import { operationLabel } from "../src/i18n/operation";

test("operation labels preserve free-text reasons even when they resemble system messages", () => {
  expect(operationLabel("en", "inventory · start")).toBe(
    "Inventory updated · start",
  );
  expect(operationLabel("zh", "reset · start · Inventory updated")).toBe(
    "重置库存环境 · start · Inventory updated",
  );
  expect(operationLabel("en", "restore #42 · 操作原因")).toBe(
    "Checkpoint restored #42 · 操作原因",
  );
  expect(operationLabel("en", "announced · #abcdef · 告别")).toBe(
    "Announcement completed · #abcdef · Goodbye",
  );
});

test("English is the deterministic default and only supported saved locales are accepted", () => {
  expect(defaultLocale).toBe("en");
  for (const value of [null, undefined, "", "fr", "en", "zh-CN", {}])
    expect(parseLocale(value)).toBe("en");
  expect(parseLocale("zh")).toBe("zh");
  expect(localeTag("zh")).toBe("zh-CN");
});

test("every translation keeps its interpolation fields", () => {
  const tokens = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [en, chinese] of Object.entries(zh)) {
    expect(chinese.trim(), en).not.toBe("");
    expect(tokens(chinese), en).toEqual(tokens(en));
  }
  expect(
    translate("en", "Open batch {batch} (add {count})", {
      batch: 2,
      count: 90,
    }),
  ).toBe("Open batch 2 (add 90)");
  expect(
    translate("zh", "Open batch {batch} (add {count})", {
      batch: 2,
      count: 90,
    }),
  ).toBe("开放第 2 批（90 份）");
});

test("API and SDK diagnostics localize without translating guest speech or persisted gift content", () => {
  expect(translateText("en", "请先结束当前一局，再管理库存")).toBe(
    "End the current session before managing inventory.",
  );
  expect(
    translateText(
      "zh",
      "Couldn't play your recording. Check your speakers and Chrome's sound permissions, then try again.",
    ),
  ).toContain("录音回放失败");
  expect(
    translateText("en", "TTS 语音服务异常，代码 503，请工作人员检查配置。"),
  ).toBe(
    "There's a problem with TTS (code 503). Ask a staff member to check the voice settings.",
  );
  expect(translateText("en", "库存已变更，请刷新后重新核对")).toContain(
    "Inventory changed",
  );
  expect(modeLabel("en", "rehearsal")).toBe("Rehearsal");
  expect(modeLabel("zh", "rehearsal")).toBe("彩排");
  expect(statusLabel("en", "gifted")).toBe("Gift revealed · Keep chatting");
  expect(translateText("en", "My custom gift / 我的礼品")).toBe(
    "My custom gift / 我的礼品",
  );
});
