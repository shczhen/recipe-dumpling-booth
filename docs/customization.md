# Customize the booth

## Character and games

Change `src/server/prompts/host.ts` for personality, and `src/server/prompts/games.ts` for each game's English/Chinese greeting and rules. `src/shared/games.ts` contains the IDs, names, and short staff hints. Keep IDs consistent. [The games guide](games.md) explains how the existing games work.

Prompts never allocate stock. Leave timing and gift ownership in the service, and do not ask the model to emit control markers into spoken dialogue.

## Artwork

`public/dumpling/appearance.json` contains versioned, public configuration. Use same-origin absolute paths such as `/dumpling/my-host.webp`. Put the files under `public/`. Remote URLs are not accepted.

| Slot                                | Content                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `hosts`                             | Welcome, listening, thinking, speaking, gifting, paused poses |
| `frame`, `swash`, `bubble`, `clock` | Paper frame, brush accent, speech bubble, clock               |
| `giftImages`                        | Exactly seven image paths or `null` entries, in catalog order |
| `idleInvitations`                   | Short `{ "en": "…", "zh": "…" }` bubble lines                 |

Transparent character artwork works best. Missing or malformed configuration falls back to compiled defaults. Missing replacement images fall back to the bundled slot; if that also fails, the layout keeps its space. Idle greetings are visual only. Motion honors reduced-motion preferences.

## Gifts and inventory

`scripts/catalog.json` defines **fresh database** defaults: seven bilingual gifts and four batches. Each row has seven nonnegative integers. Rank means a catalog index, not a prize tier. Available units determine selection weight. The sample totals are 20, 10, 10, 60, 100, 100, and 200.

After initialization, the saved database owns names and quantities. Edit them between sessions on `/admin`, with an operation reason. Changes apply only to the selected inventory environment. Existing gift results retain their saved names. Editing catalog defaults or `GIFTS_JSON` does not overwrite saved inventory.

This recipe supports seven gift categories. Changing that number also requires updating command validation, appearance validation, layout, and restore validation; it is not a configuration-only change.

## Language and captions

`src/i18n/messages.ts` maps English UI strings to Simplified Chinese. English is the default; preference is saved locally and shared between same-origin browser windows. The provider lives above route error boundaries.

Session language starts from the staff selection and follows completed guest utterances. Older HTTP responses cannot roll it back. Captions show the actual spoken language, not translations. A streaming utterance updates in place; completed lines move into a smaller history. Length limits, wrapping, and scroll handling keep long captions within their reserved area.
