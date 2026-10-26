# Dumpling Booth

A voice AI booth where a quick-witted dumpling shop owner plays a game with you, talks a little trash, and sends you home with a gift.

A laptop runs the staff controls. A second window on a TV shows Hu Jiaoman, the animated host, with live captions. Five short conversation games keep things moving; the application takes care of the timer, gift announcements, and inventory.

[简体中文](README.zh-CN.md) · [Build it step by step](docs/ai/RECIPE.md) · [The five games](docs/games.md)

![Guest screen, English](docs/assets/guest-en.png)

## Try it locally

Use **Node.js 24 or later** and **pnpm 12.14.0**.

```sh
git clone https://github.com/shczhen/recipe-dumpling-booth.git
cd recipe-dumpling-booth
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

1. Open `http://127.0.0.1:3000/admin` on the laptop.
2. Open `http://127.0.0.1:3000/` in another window **in the same browser and profile**. Move it to the TV if you have one.
3. On the guest screen, choose **Test without audio**. In the staff window, use **Rehearsal** inventory and **Demo mode**, choose a game or leave it on Random, then start.
4. Type a line from the staff controls to exercise captions. The timer starts with the greeting. At about 90 seconds, the gift announcement begins. After the reveal, there is up to 20 seconds of chat, then a goodbye.

The local demo uses scripted replies and browser speech synthesis when audio is enabled. It demonstrates the interface and session flow; playing the games with an AI host requires live voice. No cloud credentials or external database are needed for local rehearsal.

## Connect live voice

Copy your own Agora project credentials into `.env.local`, enable Conversational AI on that project, set `AGORA_ENABLED=true`, and restart. The recipe uses the **Agora Agents SDK** with Ares ASR, an OpenAI-compatible LLM, and MiniMax TTS. The included voice preset is `Arrogant_Miss`; availability depends on your project and region.

If you bring your own LLM, fill in **all three** of `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL`. Use a full Chat Completions endpoint URL and a model your account can access. Leave all three blank to use the SDK's configured provider path, which requires the corresponding service entitlement.

On the guest screen, select the microphone and speaker, record and replay a short test, and confirm that you heard it. Use **Live voice** in the staff window. See [the tutorial](docs/ai/RECIPE.md#2-connect-the-voice-services) for details.

## Make it yours

- **Games and character:** [game prompts](src/server/prompts/games.ts), [host prompt](src/server/prompts/host.ts). [Rules and example conversations](docs/games.md) explain all five games.
- **Artwork and greetings:** [appearance.json](public/dumpling/appearance.json). Host poses, speech bubbles, clocks, and seven gift slots can be replaced independently.
- **Gifts and stock:** edit names and quantities between sessions in the staff inventory screen. [catalog.json](scripts/catalog.json) supplies the initial seven sample gifts and four batches, totaling 500 items.
- **Language:** English is the default. Switch to 简体中文 in either window. Interface preference and spoken language are independent; captions show the actual conversation.

[Customization](docs/customization.md) · [Asset provenance](docs/ASSETS.md) · [Deployment and recovery](docs/deployment.md)

## Development and delivery

```sh
pnpm verify                 # types, unit/API/media tests, production build
pnpm exec playwright install chromium
pnpm test:ui                # browser tests; synthetic media, no cloud calls
pnpm package:portable       # build first; produces a package for the current OS/CPU
```

Portable packages include Node and local SQLite for Windows or macOS. **Live voice still needs internet access.** Vercel with a separate remote libSQL database is an optional online deployment. See [deployment](docs/deployment.md) and [contributing](CONTRIBUTING.md).

Licensed under the [Apache License 2.0](LICENSE). Third-party components retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Event hardware acceptance and Recipes catalog submission are tracked in the [release checklist](docs/release-checklist.md).
