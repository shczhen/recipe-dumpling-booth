import type { Language } from "../shared/model";
import { translate, translateText } from "./locale";

const actions = {
  start: "Start session",
  opening: "Opening started",
  announced: "Announcement completed",
  cancel: "Session ended",
  next: "Next guest ready",
  batch: "Batch opened",
  inventory: "Inventory updated",
  reset: "Inventory reset",
  checkpoint: "Manual checkpoint",
  restore: "Checkpoint restored",
  mode: "Inventory switched",
} as const;

export function operationLabel(locale: Language, value: string) {
  const [head, ...details] = value.split(" · ");
  const key = head.match(/^[\w-]+/)?.[0];
  const label =
    key && Object.hasOwn(actions, key)
      ? head.replace(
          /^[\w-]+/,
          translate(locale, actions[key as keyof typeof actions]),
        )
      : translateText(locale, head);
  // Only an announced action has a known system suffix here. Other details
  // contain staff reasons or checkpoint labels and must remain verbatim.
  if (key === "announced" && ["告别", "送礼"].includes(details.at(-1) ?? ""))
    details[details.length - 1] = translateText(locale, details.at(-1)!);
  return [label, ...details].join(" · ");
}
