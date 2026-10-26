import { useEffect, useState } from "react";
import { z } from "zod";

export const defaultInvitations = [
  {
    zh: "有人来试试美味的饺子吗？",
    en: "Who's up for dumplings?",
  },
  {
    zh: "饺子配酒，越喝越有！",
    en: "Dumplings and a drink? Now you're talking!",
  },
  { zh: "来，坐下聊两句。", en: "Pull up a chair. Let's have a chat." },
  {
    zh: "热乎饺子刚出锅，就等你啦！",
    en: "Fresh dumplings! Come and get 'em!",
  },
];

// Public art configuration contains no credentials or business decisions.
const localImage = z
  .string()
  .max(512)
  .refine(
    (path) =>
      path.startsWith("/") && !path.startsWith("//") && !path.includes("\\"),
  );
const appearanceSchema = z.object({
  version: z.literal(1),
  frame: localImage,
  swash: localImage,
  bubble: localImage.default("/dumpling/art/speech-bubble.webp"),
  hosts: z.object({
    welcome: localImage,
    listening: localImage,
    thinking: localImage.default("/dumpling/art/host-thinking.webp"),
    speaking: localImage,
    gifting: localImage,
    paused: localImage,
  }),
  clock: localImage,
  giftImages: z.array(localImage.nullable()).length(7),
  idleInvitations: z
    .array(
      z.object({
        zh: z.string().trim().min(1).max(100),
        en: z.string().trim().min(1).max(180),
      }),
    )
    .min(1)
    .max(12)
    .default(defaultInvitations),
});
export type Appearance = z.infer<typeof appearanceSchema>;
// Independent compiled fallback survives a missing or malformed editable file.
export const defaultAppearance: Appearance = {
  version: 1,
  frame: "/dumpling/art/paper-frame.webp",
  swash: "/dumpling/art/green-swash.webp",
  bubble: "/dumpling/art/speech-bubble.webp",
  clock: "/dumpling/art/clock.webp",
  hosts: {
    welcome: "/dumpling/art/host-welcome.webp",
    listening: "/dumpling/art/host-listening.webp",
    thinking: "/dumpling/art/host-thinking.webp",
    speaking: "/dumpling/art/host-welcome.webp",
    gifting: "/dumpling/art/host-gifting.webp",
    paused: "/dumpling/art/host-listening.webp",
  },
  giftImages: [1, 2, 3, 4, 5, 6, 7].map(
    (rank) => `/dumpling/gifts/prize-${rank}.svg`,
  ),
  idleInvitations: defaultInvitations,
};

export function useAppearance() {
  const [appearance, setAppearance] = useState(defaultAppearance);
  useEffect(() => {
    // Warm the pose images while waiting so the first state change can reuse
    // downloaded artwork instead of briefly showing an empty counter.
    for (const src of new Set(Object.values(appearance.hosts))) {
      const image = new Image();
      image.src = src;
      void image.decode().catch(() => {});
    }
  }, [appearance.hosts]);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/dumpling/appearance.json", {
      signal: controller.signal,
      cache: "no-cache",
    })
      .then(async (response) => {
        if (!response.ok) return;
        const parsed = appearanceSchema.safeParse(await response.json());
        if (!parsed.success) return;
        const checked = { ...parsed.data };
        // CSS backgrounds do not emit React onError. Resolve their fallbacks
        // before applying an editable URL to the paper or brush highlight.
        await Promise.all(
          (["frame", "swash"] as const).map(async (slot) => {
            checked[slot] = await new Promise<string>((resolve) => {
              const image = new Image();
              image.onload = () => resolve(parsed.data[slot]);
              image.onerror = () => resolve(defaultAppearance[slot]);
              image.src = parsed.data[slot];
            });
          }),
        );
        if (!controller.signal.aborted) setAppearance(checked);
      })
      .catch(() => {
        /* Compiled defaults keep the display usable. */
      });
    return () => controller.abort();
  }, []);
  return appearance;
}
