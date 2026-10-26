import {
  AgoraClient,
  Agent,
  Area,
  AresSTT,
  ExpiresIn,
  MiniMaxTTS,
  OpenAI,
  generateConvoAIToken,
} from "agora-agents";
import agoraToken from "agora-token";
import { announcementText, type Session } from "../shared/model";
import { hostPrompt } from "./prompts/host";

export const channelFor = (id: string) => `dumpling-${id}`;
export function agoraGateway(env: NodeJS.ProcessEnv = process.env) {
  const appId = env.AGORA_APP_ID ?? "";
  const appCertificate = env.AGORA_APP_CERTIFICATE ?? "";
  const area = { US: Area.US, EU: Area.EU, AP: Area.AP }[
    env.AGORA_AREA ?? "AP"
  ];
  if (!area)
    throw new Error("首版 AGORA_AREA 仅支持 AP/US/EU；CN 供应商需另配后联调");
  const client = new AgoraClient({
    appId,
    appCertificate,
    area,
    timeoutInSeconds: 10,
    maxRetries: 0,
  });
  return {
    connection(session: Session) {
      return {
        appId,
        channel: channelFor(session.id),
        uid: "100",
        agentUid: "200",
        token: agoraToken.RtcTokenBuilder.buildTokenWithRtm(
          appId,
          appCertificate,
          channelFor(session.id),
          "100",
          agoraToken.RtcRole.PUBLISHER,
          600,
          600,
        ),
      };
    },
    async start(session: Session) {
      const llmOptions = {
        systemMessages: [
          { role: "system" as const, content: hostPrompt(session) },
        ],
        greetingMessage: session.opening,
        failureMessage:
          session.language === "zh"
            ? "稍等一下，我们马上继续。"
            : "One moment, please.",
        maxHistory: 20,
      };
      const llm =
        env.LLM_BASE_URL && env.LLM_API_KEY
          ? new OpenAI({
              ...llmOptions,
              url: env.LLM_BASE_URL,
              apiKey: env.LLM_API_KEY,
              model: env.LLM_MODEL || "gpt-4o-mini",
              ...(env.LLM_REASONING_EFFORT
                ? { params: { reasoning_effort: env.LLM_REASONING_EFFORT } }
                : {}),
            })
          : new OpenAI({ ...llmOptions, model: "gpt-4o-mini" });
      const agent = new Agent({
        client,
        turnDetection: {
          language: session.language === "zh" ? "zh-CN" : "en-US",
          config: {
            speech_threshold: 0.65,
            start_of_speech: {
              mode: "vad",
              vad_config: {
                interrupt_duration_ms: 300,
                prefix_padding_ms: 300,
              },
            },
            end_of_speech: {
              mode: "vad",
              vad_config: { silence_duration_ms: 700 },
            },
          },
        },
        advancedFeatures: { enable_rtm: true, enable_tools: false },
        parameters: { data_channel: "rtm", enable_error_message: true },
      })
        .withStt(new AresSTT())
        .withLlm(llm)
        .withTts(
          new MiniMaxTTS({
            model: "speech_2_6_turbo",
            voiceId: env.AGORA_VOICE_ID ?? "",
            ...(env.TTS_API_KEY ? { key: env.TTS_API_KEY } : {}),
          }),
        );
      return agent
        .createSession({
          name: channelFor(session.id),
          channel: channelFor(session.id),
          agentUid: "200",
          remoteUids: ["100"],
          idleTimeout: 180,
          expiresIn: ExpiresIn.minutes(5),
          debug: false,
        })
        .start();
    },
    async close(session: Session) {
      if (!session.agentId || !session.result) return;
      const token = generateConvoAIToken({
        appId,
        appCertificate,
        channelName: channelFor(session.id),
        uid: 200,
        tokenExpire: 600,
      });
      await client.agents.speak(
        {
          appid: appId,
          agentId: session.agentId,
          text: announcementText(session)!,
          priority: "INTERRUPT",
          interruptable: false,
        },
        { headers: { Authorization: `agora token=${token}` } },
      );
    },
    async resume(session: Session) {
      if (!session.agentId || !["chatting", "gifted"].includes(session.status))
        return;
      const token = generateConvoAIToken({
        appId,
        appCertificate,
        channelName: channelFor(session.id),
        uid: 200,
        tokenExpire: 600,
      });
      await client.agents.update(
        {
          appid: appId,
          agentId: session.agentId,
          properties: {
            llm: {
              system_messages: [
                { role: "system", content: hostPrompt(session) },
              ],
            },
          },
        },
        { headers: { Authorization: `agora token=${token}` } },
      );
    },
    async stop(agentId: string) {
      await client.stopAgent(agentId);
    },
  };
}
export type AgoraGateway = ReturnType<typeof agoraGateway>;
