# 饺子铺 · Dumpling Booth

和爱接梗的饺子铺老板娘胡饺蛮玩一局，聊两句，再领一份小礼品。

工作人员用电脑控制开局，电视或扩展屏展示老板娘、字幕和礼品。五种小游戏靠对话进行，程序负责计时、礼品播报和库存。老板娘有待机、听、想、说、送礼等姿态，待机气泡会轮换。

[English](README.md) · [完整 Recipe 教程（英文）](docs/ai/RECIPE.md) · [五种玩法与示例](docs/games.zh-CN.md)

![中文观众页](docs/assets/guest-zh.png)

## 本地体验

需要 **Node.js 24 及以上**、**pnpm 12.14.0**。

```sh
git clone https://github.com/shczhen/recipe-dumpling-booth.git
cd recipe-dumpling-booth
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

1. 电脑打开 `http://127.0.0.1:3000/admin`。
2. 在**同一浏览器、同一用户配置**中另开 `http://127.0.0.1:3000/`，拖到扩展屏。两页的域名和端口保持一致。
3. 默认界面是英文，右上角可切换简体中文。观众页选择“无声演练”，管理页使用“彩排”库存和“流程演练”，选一种玩法或保持随机，启动一局。
4. 在管理页输入一句话查看字幕。开场播放时开始计时；默认 120 秒一局，约第 90 秒进入送礼播报，揭晓后最多再聊 20 秒，然后告别。

本地演练使用固定回复；启用声音时用浏览器朗读。它能演练页面、计时、字幕和发礼流程。要和 AI 真正玩游戏，需要接通实时语音。本地演练不需要云端密钥或外部数据库。

## 接通语音

在自己的 Agora 项目中启用 Conversational AI，把 App ID、证书填进 `.env.local`，设置 `AGORA_ENABLED=true`，重启服务。本项目使用 **Agora Agents SDK** 配置 Ares ASR → OpenAI 兼容 LLM → MiniMax TTS。默认音色为 `Arrogant_Miss`，以自己的项目、区域实际支持情况为准。

自带 LLM 时，同时填写 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`。地址使用完整的 Chat Completions 接口，模型填写自己账号实际可用的名称。三项均留空则使用 SDK 提供的服务路径，需要项目有相应服务权限。

观众页选择输入和输出设备，临时录一小段并回放，确认能听到；管理页再选“真实语音”。录音只在浏览器内用于设备检查，不上传。详见[教程](docs/ai/RECIPE.md#2-connect-the-voice-services)。

## 可以替换什么

- [五种玩法](docs/games.zh-CN.md)：二十问、你描述她来猜、食物接龙、故事接龙、答非所问。模型负责陪玩，程序不判分；每位开聊的观众都有礼品。
- [人物和玩法提示词](src/server/prompts/)：修改人物语气和游戏规则。
- [美术配置](public/dumpling/appearance.json)：分别替换人物姿态、气泡、计时器和七种礼品图。礼品图已换成通用 SVG 图标。
- [初始库存](scripts/catalog.json)：七种示例礼品，分四批共 500 份。日常改名、补货、开放批次在管理页操作，已保存的结果不会跟着改名或重抽。
- 中英文界面与实际对话语言分开管理；字幕保留原语言，最近完成的字幕在上方缩小显示。

[定制说明](docs/customization.md) · [素材来源](docs/ASSETS.md) · [部署与恢复](docs/deployment.md)

## 开发与交付

```sh
pnpm verify
pnpm exec playwright install chromium
pnpm test:ui
pnpm package:portable
```

先构建再打便携包。Windows 和 macOS 包各自携带 Node 和 SQLite，现场无需安装数据库；**实时语音仍需联网**。也可部署到 Vercel，使用独立的远程 libSQL 库及管理、体验口令。

目前是私有准备仓库，**项目许可证待确认**，尚未向 Recipes 提交。第三方素材许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，发布前事项见[清单](docs/release-checklist.md)。
