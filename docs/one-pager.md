# Dumpling Booth

Recipe overview · 2026-10-26

**Build a dual-screen voice AI booth with a playful character, five conversation games, live captions, timed gift announcements, and persistent inventory.** Visitors meet Hu Jiaoman, a quick-witted dumpling shop owner. Developers can use the same setup at an event with their own character, artwork, and prizes.

## The experience

A laptop runs staff controls; a second browser window on a TV shows the host. While waiting, her artwork moves gently and short greeting bubbles rotate. Listening, thinking, speaking, and gifting have distinct poses. Captions stream into a reserved area, with recent completed utterances above the current one.

Staff select a game or leave it on Random: Twenty questions, Describe and guess, Food chain, Story chain, or Wrong answers. Rules live in prompts; play, mistakes, hints, and rematches happen in conversation. [The games guide](games.md) includes rules and illustrative exchanges, with a [Chinese version](games.zh-CN.md).

A default session lasts 120 seconds. The clock starts when the greeting plays. At about 90 seconds, the application saves one random gift, interrupts the current conversation, and speaks the result. After the reveal, allow up to 20 seconds of chat, then a goodbye. Everyone who starts gets a gift, independent of game outcome. Known results survive retries, stops, reconnect failures, restarts, and recovery without redrawing.

## What the recipe teaches

| Area             | Implementation                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Interface        | TanStack Start, React, shadcn; separate staff and guest views, animated character states and captions     |
| Voice            | Agora Agents SDK: Ares ASR → OpenAI-compatible LLM → MiniMax TTS; RTC audio and RTM/Client Toolkit events |
| Reliable actions | Server clock, SQLite transactions, seven-category inventory, four batches, checkpoints and backup restore |
| Localization     | English default, Simplified Chinese support; interface preference separate from voice and captions        |
| Event setup      | Microphone/speaker selection, temporary local recording/playback check, Windows/macOS portable packages   |

The host and game prompts stay separate from application-owned gifts and inventory. Gift and goodbye completion use matching transcript, media timestamps, and a quiet interval. Local scripted rehearsal needs no cloud credentials. Live voice requires a network and the reader's own service access.

## Delivery

The implementation lives in `shczhen/recipe-dumpling-booth`. It includes the approved host artwork and generic Lucide prize icons. Configuration templates contain no credentials, and runtime data is excluded from the source repository. Original project code, documentation, and project artwork are licensed under Apache 2.0; third-party licenses are preserved separately.

The [English Recipe](ai/RECIPE.md), Chinese README, game guides, screenshots, and delivery guides cover local rehearsal, live voice, customization, portable packaging, and optional Vercel/libSQL deployment. Publication and hardware acceptance status are tracked in the [release checklist](release-checklist.md).

## Catalog proposal

Title **Dumpling Booth**, slug **dumpling-booth**, platform **TypeScript**, tag **voice-ai**, difficulty **Advanced**, author **shczhen**. `recipe.json` points to `docs/ai/RECIPE.md` on the implementation repository's main branch. The source and tutorial must be publicly readable for catalog submission.

Metadata follows the [Recipes contribution guide](https://github.com/AgoraIO-Community/agora-recipes/blob/main/CONTRIBUTING.md) checked on 2026-10-26. Public submission targets `staging`, including generated catalog artifacts; the implementation repository and recipe Markdown must be public at catalog build time.
