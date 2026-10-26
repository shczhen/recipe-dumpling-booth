# Release checklist

Source publication, event hardware acceptance, and Recipes catalog submission are separate steps.

## Repository contents

- [x] Apache License 2.0 selected; root `LICENSE`, `NOTICE`, and package metadata added.
- [x] Approved host artwork retained; original event prize images replaced with generic icons.
- [x] Third-party icon, font, UI primitive, and dependency notices preserved.
- [x] Credential values, real inventory, recordings, and runtime logs excluded from tracked source and clean portable packages.

## Before running an event

- [ ] Validate the voice preset, ASR, model access, English and Chinese on the intended Agora project and region.
- [ ] Test the actual microphone and TV speakers, including output selection, unplugging devices, permissions, and consecutive guests.
- [ ] Smoke-test native portable packages on the target macOS and Windows event computers; CI and synthetic media tests do not replace this.
- [ ] Record a short live demonstration video using accounts and hardware approved for public display. The game-guide exchanges are illustrative examples.

## Recipes catalog submission

- [ ] Regenerate the catalog artifact from the public main-branch tutorial, check that its Markdown is nonempty with no fetch error, and submit metadata plus generated content to upstream `staging`.

The supplied `recipe.json` is catalog metadata, not evidence of catalog acceptance. Dependencies are pinned by the lockfile; review their notices when publishing a release archive.
