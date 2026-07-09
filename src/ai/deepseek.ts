import type {
  AiAction,
  AiActionContext,
  AiSettings,
  CodexDailyReview,
  CodexReviewInput,
  ConversationReviewInput,
  DailyConversationReview,
  Item,
  JournalEntry,
  SummaryReport,
} from "../types";
import { resolveAiSettingsForRequest } from "../lib/aiSecrets";
import { getSafeErrorMessage } from "../lib/redaction";

type ChatMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | {
          type: "image_url";
          image_url: {
            url: string;
          };
        }
    >;

type ChatMessage = {
  role: "system" | "user";
  content: ChatMessageContent;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type ChatCompletionStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
};

type EffectiveAiSettings = AiSettings & {
  apiKey: string;
  keySource: "env" | "manual" | "missing";
};

type AiActionResultMeta = {
  outputCharCount: number;
  displayText: string;
};

type AiRequestOptions = {
  maxTokens?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
};

const AI_REQUEST_TIMEOUT_MS = 90_000;
const AI_STREAM_TIMEOUT_MS = 180_000;

export type AiActionResult = (
  | { action: "summarize"; aiSummary: string }
  | { action: "title"; title: string }
  | { action: "tags"; tags: string[] }
  | { action: "todos"; todos: string[] }
) &
  AiActionResultMeta;

export type JournalPeriod = Pick<SummaryReport, "periodType" | "periodStart" | "periodEnd">;

export type JournalSummaryResult = {
  title: string;
  content: string;
};

export type CodexReviewProgressStage =
  | "读取会话"
  | "本地脱敏"
  | "分块整理"
  | "合成每日回顾"
  | "提出记忆修改建议"
  | "流式降级";

export type CodexReviewProgress = {
  stage: CodexReviewProgressStage;
  message: string;
  partialContent?: string;
};

export type MemoryPatchSuggestion = {
  title: string;
  rationale: string;
  proposedContent: string;
};

export type MemoryCandidateDraft = {
  title: string;
  content: string;
  category: string;
};

export type LibraryCardDraft = {
  title: string;
  content: string;
  tags: string[];
  aiSummary: string;
};

export function hasEnvApiKey() {
  return Boolean(import.meta.env.VITE_DEEPSEEK_API_KEY);
}

export function getProviderLabel(settings: Pick<AiSettings, "provider" | "customProviderName">) {
  return settings.provider === "openai-compatible" ? settings.customProviderName?.trim() || "OpenAI 兼容模型" : "DeepSeek";
}

export function getEffectiveAiSettings(settings: AiSettings): EffectiveAiSettings {
  const isDeepSeek = settings.provider !== "openai-compatible";
  const envApiKey = isDeepSeek && settings.useEnvKey ? import.meta.env.VITE_DEEPSEEK_API_KEY?.trim() : "";
  const manualApiKey = settings.manualApiKey?.trim();
  const apiKey = envApiKey || manualApiKey || "";
  const hasStoredManualKey = Boolean(settings.manualKeyStored);

  return {
    ...settings,
    provider: isDeepSeek ? "deepseek" : "openai-compatible",
    baseUrl: isDeepSeek && settings.useEnvKey ? import.meta.env.VITE_DEEPSEEK_BASE_URL || settings.baseUrl : settings.baseUrl,
    model: isDeepSeek && settings.useEnvKey ? import.meta.env.VITE_DEEPSEEK_MODEL || settings.model : settings.model,
    apiKey,
    keySource: envApiKey ? "env" : apiKey || hasStoredManualKey ? "manual" : "missing",
  };
}

export async function testAiConnection(settings: AiSettings) {
  return callDeepSeek(settings, [
    {
      role: "system",
      content: "你是一个 API 连通性测试助手，只返回简短中文。",
    },
    {
      role: "user",
      content: "请只回复：连接正常",
    },
  ]);
}

export const testDeepSeekConnection = testAiConnection;

export async function runAiAction(
  item: Item,
  action: AiAction,
  settings: AiSettings,
  context: AiActionContext = {},
  options: AiRequestOptions = {},
): Promise<AiActionResult> {
  if (context.imageDataUrl && !settings.supportsVision) {
    throw new Error("当前模型未开启图片分析能力，请在设置页切换到支持视觉的 OpenAI 兼容模型。");
  }
  if (item.filePath && !context.fileText?.trim() && !context.imageDataUrl) {
    throw new Error("本地附件还没有完成可信读取，AI 操作已停止。不会根据路径或旧摘要猜测文件内容。");
  }

  const content = await callDeepSeek(settings, buildItemMessages(item, action, context), options);
  const displayText = content.trim();
  const meta: AiActionResultMeta = {
    displayText,
    outputCharCount: countCharacters(displayText),
  };

  if (action === "summarize") {
    return { action, aiSummary: displayText, ...meta };
  }

  if (action === "title") {
    return { action, title: cleanTitle(content), ...meta };
  }

  if (action === "tags") {
    return { action, tags: parseListOutput(content).slice(0, 8), ...meta };
  }

  return { action, todos: parseListOutput(content).slice(0, 12), ...meta };
}

export async function generateTitleFromContent(content: string, settings: AiSettings) {
  const result = await callDeepSeek(settings, [
    {
      role: "system",
      content: "你是个人知识库标题助手。只输出一个中文短标题，不要解释。",
    },
    {
      role: "user",
      content: `请根据下面内容生成一个 16 个汉字以内的标题。只输出标题。\n\n${content}`,
    },
  ]);

  return cleanTitle(result).slice(0, 24);
}

export async function summarizeJournalPeriod(
  entries: JournalEntry[],
  period: JournalPeriod,
  settings: AiSettings,
): Promise<JournalSummaryResult> {
  const periodLabel = period.periodType === "day" ? "日" : period.periodType === "week" ? "周" : "月";
  const content = await callDeepSeek(settings, [
    {
      role: "system",
      content:
        "你是个人日志复盘助手。请输出 JSON 对象，字段为 title 和 content。content 用中文，包含重要事件、想法线索、待办趋势和可复盘点。",
    },
    {
      role: "user",
      content: `周期：${periodLabel}，${period.periodStart} 到 ${period.periodEnd}\n\n日志：\n${formatJournalEntries(entries)}\n\n只输出 JSON。`,
    },
  ]);

  const parsed = parseJsonObject(content);
  return {
    title: cleanTitle(String(parsed.title ?? `${period.periodStart} 复盘`)),
    content: String(parsed.content ?? content).trim(),
  };
}

export async function extractMemoryCandidates(
  summary: SummaryReport | JournalSummaryResult,
  entries: JournalEntry[],
  settings: AiSettings,
): Promise<MemoryCandidateDraft[]> {
  const content = await callDeepSeek(settings, [
    {
      role: "system",
      content:
        "你是长期记忆提取助手。只提取长期稳定、未来可能有用的事实、偏好、习惯、项目背景或反复出现的目标。输出 JSON 数组，每项包含 title、content、category。",
    },
    {
      role: "user",
      content: `总结：\n${summary.content}\n\n原始日志：\n${formatJournalEntries(entries)}\n\n如果没有值得保存的长期记忆，输出 []。`,
    },
  ]);

  const parsed = parseJsonArray(content);
  return parsed
    .map((item) => ({
      title: cleanTitle(String(item.title ?? "")),
      content: String(item.content ?? "").trim(),
      category: String(item.category ?? "一般").trim(),
    }))
    .filter((item) => item.title && item.content)
    .slice(0, 8);
}

export async function generateLibraryCardFromJournal(
  entry: JournalEntry,
  settings: AiSettings,
  options: AiRequestOptions = {},
): Promise<LibraryCardDraft> {
  const content = await callDeepSeek(settings, [
    {
      role: "system",
      content:
        "你是个人知识库整理助手。请把一条日常日志沉淀成长期知识卡片草稿。输出 JSON 对象，字段为 title、content、tags、aiSummary。",
    },
    {
      role: "user",
      content: `日志时间：${entry.entryDate}\n标签：${entry.tags.join("，") || "无"}\n待办：${entry.todos.join("；") || "无"}\n正文：\n${entry.content}\n\n只输出 JSON。`,
    },
  ], options);

  const parsed = parseJsonObject(content);
  return {
    title: cleanTitle(String(parsed.title ?? "")) || createLocalTitle(entry.content),
    content: String(parsed.content ?? entry.content).trim(),
    tags: Array.isArray(parsed.tags)
      ? parsed.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8)
      : entry.tags,
    aiSummary: String(parsed.aiSummary ?? "由日志沉淀成知识卡片。").trim(),
  };
}

export async function summarizeCodexDay(
  input: CodexReviewInput,
  settings: AiSettings,
): Promise<JournalSummaryResult> {
  const chunks = input.transcriptChunks.filter((chunk) => chunk.trim());
  if (chunks.length === 0) {
    throw new Error("这一天没有可用于回顾的 Codex 对话内容。");
  }

  const chunkSummaries: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const summary = await callDeepSeek(
      settings,
      [
        {
          role: "system",
          content:
            "你是 Codex 对话整理助手。请把这一段对话压缩成中文阶段摘要，保留工作内容、关键决定、未完成事项和用户偏好。不要记录密钥、token、长路径或一次性命令输出。",
        },
        {
          role: "user",
          content: `日期：${input.date}\n片段：${index + 1}/${chunks.length}\n\n${chunk}`,
        },
      ],
      { maxTokens: 1100 },
    );
    chunkSummaries.push(summary.trim());
  }

  const content = await callDeepSeek(
    settings,
    [
      {
        role: "system",
        content:
          "你是个人工作/聊天回顾助手。请输出 JSON 对象，字段为 title 和 content。content 用中文，语气安静克制，包含：今天做了什么、聊了什么、完成与未完成、关键决定、值得沉淀的线索。",
      },
      {
        role: "user",
        content: `日期：${input.date}\n会话数：${input.sessions.length}\n内容曾脱敏：${input.redacted ? "是" : "否"}\n内容曾截断：${input.truncated ? "是" : "否"}\n\n阶段摘要：\n${chunkSummaries
          .map((summary, index) => `【片段 ${index + 1}】\n${summary}`)
          .join("\n\n---\n\n")}\n\n只输出 JSON。`,
      },
    ],
    { maxTokens: 1800 },
  );

  const parsed = parseJsonObject(content);
  return {
    title: cleanTitle(String(parsed.title ?? `${input.date} Codex 回顾`)),
    content: String(parsed.content ?? content).trim(),
  };
}

export async function streamSummarizeConversationReview(
  input: ConversationReviewInput,
  settings: AiSettings,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
): Promise<JournalSummaryResult> {
  const chunks = input.transcriptChunks.filter((chunk) => chunk.trim());
  if (chunks.length === 0) {
    throw new Error("这一天没有可用于回顾的 AI 对话内容。");
  }

  onProgress({
    stage: "本地脱敏",
    message: input.redacted ? "已在本机替换疑似密钥与凭据。" : "未发现明显需要脱敏的内容。",
  });

  const chunkSummaries: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    onProgress({
      stage: "分块整理",
      message: `正在整理第 ${index + 1}/${chunks.length} 段。`,
    });
    const summary = await callDeepSeek(
      settings,
      [
        {
          role: "system",
          content:
            "你是 AI 对话整理助手。请把这一段对话压缩成中文阶段摘要，保留工作内容、关键决定、未完成事项和稳定偏好。不要记录密钥、token、长路径、工具原始输出或一次性命令输出。",
        },
        {
          role: "user",
          content: `日期：${input.date}\n来源：${formatConversationSource(input)}\n片段：${index + 1}/${chunks.length}\n\n${chunk}`,
        },
      ],
      { maxTokens: 1100, signal },
    );
    chunkSummaries.push(summary.trim());
  }

  const messages = buildConversationReviewSynthesisMessages(input, chunkSummaries);
  onProgress({ stage: "合成每日回顾", message: "正在写成一份可以细读的回顾。" });

  let streamed = "";
  try {
    streamed = await callDeepSeekStream(
      settings,
      messages,
      (token, fullText) => {
        onProgress({
          stage: "合成每日回顾",
          message: "回顾正在生成。",
          partialContent: fullText,
        });
      },
      { maxTokens: 2200, signal },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    onProgress({
      stage: "流式降级",
      message: "流式返回不稳定，已停止。本次不会自动重发对话内容；需要的话请手动重试。",
    });
    throw new Error(formatStreamFailure(error, "AI 对话回顾生成中断，未自动重试。"));
  }

  const content = stripCodeFence(streamed).trim();
  return {
    title: extractMarkdownTitle(content) || `${input.date} ${formatConversationSource(input)}回顾`,
    content,
  };
}

export async function streamSummarizeCodexReview(
  input: CodexReviewInput,
  settings: AiSettings,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
): Promise<JournalSummaryResult> {
  return streamSummarizeConversationReview(input, settings, onProgress, signal);
}

export async function generateMemoryPatchFromReview(
  review: DailyConversationReview,
  currentMemory: string,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<MemoryPatchSuggestion> {
  return streamGenerateMemoryPatchFromReview(review, currentMemory, settings, () => undefined, signal);
}

export async function streamGenerateMemoryPatchFromReview(
  review: DailyConversationReview,
  currentMemory: string,
  settings: AiSettings,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
): Promise<MemoryPatchSuggestion> {
  onProgress({ stage: "提出记忆修改建议", message: "正在对照长期记忆文档，生成少而准的画像更新。" });
  let content = "";
  try {
    content = await callDeepSeekStream(
      settings,
      buildMemoryPatchMessages(review, currentMemory),
      (_token, fullText) => {
        onProgress({
          stage: "提出记忆修改建议",
          message: "记忆修改建议正在生成。",
          partialContent: fullText,
        });
      },
      { maxTokens: 2600, signal },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    onProgress({ stage: "流式降级", message: "记忆建议流式返回不稳定，已停止。本次不会自动重发长期记忆内容；需要的话请手动重试。" });
    throw new Error(formatStreamFailure(error, "记忆建议生成中断，未自动重试。"));
  }

  const parsed = parseJsonObject(content);
  return {
    title: cleanTitle(String(parsed.title ?? "记忆修改建议")) || "记忆修改建议",
    rationale: String(parsed.rationale ?? "根据这次 AI 对话回顾整理出的长期记忆修改建议。").trim(),
    proposedContent: String(parsed.proposedContent ?? currentMemory).trim() || currentMemory,
  };
}

export async function streamSynthesizeCombinedDailyReview(
  sourceReviews: DailyConversationReview[],
  settings: AiSettings,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
): Promise<JournalSummaryResult> {
  if (sourceReviews.length < 2) {
    throw new Error("至少需要两份来源回顾，才能合成今日总回顾。");
  }

  const date = sourceReviews[0].date;
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        "你是一个个人工作档案编辑。请把多份 AI 工具来源回顾合成为一份统一的 Markdown 今日总回顾。只输出 Markdown 正文，不要 JSON，不要代码块。结构固定为：## 今日做了什么、## 关键决定、## 还悬着的事、## 值得沉淀的线索。合并重复内容，保留差异，不写空泛评价。",
    },
    {
      role: "user",
      content: `日期：${date}\n\n${sourceReviews
        .map((review) => `【${review.sourceLabel}】${review.title}\n${review.content}`)
        .join("\n\n---\n\n")}\n\n请输出一份综合回顾。`,
    },
  ];

  onProgress({ stage: "合成每日回顾", message: "正在把多个来源合成一份今日总回顾。" });
  let streamed = "";
  try {
    streamed = await callDeepSeekStream(
      settings,
      messages,
      (_token, fullText) =>
        onProgress({ stage: "合成每日回顾", message: "综合回顾正在生成。", partialContent: fullText }),
      { maxTokens: 2200, signal },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    onProgress({ stage: "流式降级", message: "综合回顾流式返回不稳定，已停止。本次不会自动重发回顾内容；需要的话请手动重试。" });
    throw new Error(formatStreamFailure(error, "综合回顾生成中断，未自动重试。"));
  }

  const content = stripCodeFence(streamed).trim();
  return {
    title: extractMarkdownTitle(content) || `${date} 今日总回顾`,
    content,
  };
}

export async function extractCodexMemoryCandidates(
  review: CodexDailyReview,
  settings: AiSettings,
): Promise<MemoryCandidateDraft[]> {
  const content = await callDeepSeek(
    settings,
    [
      {
        role: "system",
        content:
          "你是长期记忆提取助手。只提取长期稳定、未来可能有用的事实、偏好、习惯、项目背景、设计原则或反复出现的目标。不要保存临时报错、命令输出、密钥、token、一次性路径、无上下文碎片。输出 JSON 数组，每项包含 title、content、category。",
      },
      {
        role: "user",
        content: `Codex 每日回顾：\n日期：${review.date}\n标题：${review.title}\n正文：\n${review.content}\n\n如果没有值得保存的长期记忆，输出 []。`,
      },
    ],
    { maxTokens: 1200 },
  );

  const parsed = parseJsonArray(content);
  return parsed
    .map((item) => ({
      title: cleanTitle(String(item.title ?? "")),
      content: String(item.content ?? "").trim(),
      category: String(item.category ?? "Codex").trim(),
    }))
    .filter((item) => item.title && item.content)
    .slice(0, 8);
}

function buildEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

async function callDeepSeek(
  settings: AiSettings,
  messages: ChatMessage[],
  options: AiRequestOptions = {},
) {
  const effective = getEffectiveAiSettings(await resolveAiSettingsForRequest(settings));
  const providerLabel = getProviderLabel(effective);

  if (!effective.apiKey) {
    throw new Error(`缺少 ${providerLabel} API Key。请先在设置页配置。`);
  }

  const timeoutMs = options.timeoutMs ?? AI_REQUEST_TIMEOUT_MS;
  const timeout = createTimeoutSignal(options.signal, timeoutMs);
  try {
    const response = await fetch(buildEndpoint(effective.baseUrl), {
      method: "POST",
      signal: timeout.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effective.apiKey}`,
      },
      body: JSON.stringify({
        model: effective.model,
        messages,
        stream: false,
        temperature: 0.2,
        max_tokens: options.maxTokens ?? 1200,
      }),
    });

    const data = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();

    if (!response.ok) {
      throw new Error(getSafeErrorMessage(data.error?.message, `${providerLabel} 请求失败：HTTP ${response.status}`));
    }

    if (!content) {
      throw new Error(`${providerLabel} 返回为空。`);
    }

    return content;
  } catch (error) {
    if (timeout.didTimeout()) {
      throw new Error(`${providerLabel} 请求超过 ${Math.round(timeoutMs / 1000)} 秒仍未返回，已自动停止。`);
    }
    throw new Error(getSafeErrorMessage(error, `${providerLabel} 请求失败。`));
  } finally {
    timeout.cleanup();
  }
}

async function callDeepSeekStream(
  settings: AiSettings,
  messages: ChatMessage[],
  onToken: (token: string, fullText: string) => void,
  options: AiRequestOptions = {},
) {
  const effective = getEffectiveAiSettings(await resolveAiSettingsForRequest(settings));
  const providerLabel = getProviderLabel(effective);

  if (!effective.apiKey) {
    throw new Error(`缺少 ${providerLabel} API Key。请先在设置页配置。`);
  }

  if (!effective.stream) {
    return callDeepSeek(settings, messages, { ...options, timeoutMs: options.timeoutMs ?? AI_STREAM_TIMEOUT_MS });
  }

  const timeoutMs = options.timeoutMs ?? AI_STREAM_TIMEOUT_MS;
  const timeout = createTimeoutSignal(options.signal, timeoutMs);
  try {
    const response = await fetch(buildEndpoint(effective.baseUrl), {
      method: "POST",
      signal: timeout.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${effective.apiKey}`,
      },
      body: JSON.stringify({
        model: effective.model,
        messages,
        stream: true,
        temperature: 0.2,
        max_tokens: options.maxTokens ?? 1600,
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
      throw new Error(getSafeErrorMessage(data.error?.message, `${providerLabel} 请求失败：HTTP ${response.status}`));
    }

    if (!response.body) {
      return callDeepSeek(settings, messages, { ...options, timeoutMs });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;

        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        const parsed = JSON.parse(payload) as ChatCompletionStreamChunk;
        if (parsed.error?.message) {
          throw new Error(getSafeErrorMessage(parsed.error.message, `${providerLabel} 流式请求失败。`));
        }

        const token = parsed.choices?.[0]?.delta?.content ?? "";
        if (!token) continue;

        fullText += token;
        onToken(token, fullText);
      }
    }

    const trimmed = fullText.trim();
    if (!trimmed) {
      throw new Error(`${providerLabel} 流式返回为空。`);
    }

    return trimmed;
  } catch (error) {
    if (timeout.didTimeout()) {
      throw new Error(`${providerLabel} 流式请求超过 ${Math.round(timeoutMs / 1000)} 秒仍未完成，已自动停止。`);
    }
    throw new Error(getSafeErrorMessage(error, `${providerLabel} 流式请求失败。`));
  } finally {
    timeout.cleanup();
  }
}

function createTimeoutSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  }

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("AI 请求超时。", "TimeoutError"));
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      window.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortFromParent);
    },
  };
}

function buildCodexReviewSynthesisMessages(input: CodexReviewInput, chunkSummaries: string[]): ChatMessage[] {
  return buildConversationReviewJsonMessages(input, chunkSummaries);
}

function buildConversationReviewSynthesisMessages(input: ConversationReviewInput, chunkSummaries: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是一个安静、克制的个人工作回顾编辑。请直接输出 Markdown 正文，不要输出 JSON，不要包代码块。结构固定为：## 今日做了什么、## 关键决定、## 还悬着的事、## 值得沉淀的线索。内容要具体，少写空泛鸡汤；不要记录密钥、token、一次性路径、工具原始输出或命令输出。",
    },
    {
      role: "user",
      content: `日期：${input.date}\n来源：${formatConversationSource(input)}\n会话数：${input.sessions.length}\n内容已脱敏：${input.redacted ? "是" : "否"}\n内容已截断：${input.truncated ? "是" : "否"}\n\n阶段摘要：\n${chunkSummaries
        .map((summary, index) => `【片段 ${index + 1}】\n${summary}`)
        .join("\n\n---\n\n")}\n\n请只输出 Markdown 正文。`,
    },
  ];
}

function buildConversationReviewJsonMessages(input: ConversationReviewInput, chunkSummaries: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是个人工作/聊天回顾助手。请输出 JSON 对象，字段为 title 和 content。content 使用中文，语气安静克制，结构固定为：今日做了什么、关键决定、还悬着的事、值得沉淀的线索。不要写空泛鸡汤，不要记录密钥、token、一次性路径或命令输出。",
    },
    {
      role: "user",
      content: `日期：${input.date}\n来源：${formatConversationSource(input)}\n会话数：${input.sessions.length}\n内容已脱敏：${input.redacted ? "是" : "否"}\n内容已截断：${input.truncated ? "是" : "否"}\n\n阶段摘要：\n${chunkSummaries
        .map((summary, index) => `【片段 ${index + 1}】\n${summary}`)
        .join("\n\n---\n\n")}\n\n只输出 JSON。`,
    },
  ];
}

function buildMemoryPatchMessages(review: DailyConversationReview, currentMemory: string): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是长期记忆文档编辑。请像 GPT 记忆那样维护一份第三人称、分节、可长期复用的用户画像文档。不要生成孤立卡片。只保留长期稳定信息：偏好、项目方向、工具习惯、设计原则、长期约束、反复出现的工作方式。明确排除临时报错、一次性命令、路径碎片、密钥、token、无上下文结论、当天情绪噪声。输出 JSON 对象，字段为 title、rationale、proposedContent。proposedContent 必须是完整长期记忆文档，正文不写来源日期。",
    },
    {
      role: "user",
      content: `当前长期记忆文档：\n${currentMemory || "（暂时为空）"}\n\n本次回顾来源：${review.sourceLabel}\n日期：${review.date}\n标题：${review.title}\n正文：\n${review.content}\n\n请给出少而准的修改。如果没有值得留下的长期记忆，保持原文档基本不变，并在 rationale 中说明原因。只输出 JSON。`,
    },
  ];
}

function buildItemMessages(item: Item, action: AiAction, context: AiActionContext): ChatMessage[] {
  const fileName = context.fileName || getFileNameFromPath(item.filePath);
  const authorizedFileText = context.fileText?.trim();
  const hasAuthorizedFileSource = Boolean(authorizedFileText || context.imageDataUrl);
  const itemBodyLine = hasAuthorizedFileSource
    ? "条目正文：已省略，避免污染本次文件分析；请只依据本次授权读取的文件或图片内容。"
    : `正文：${item.content || "无"}`;
  const existingSummaryLine = hasAuthorizedFileSource
    ? "现有摘要：已省略，避免污染本次文件分析。"
    : `现有摘要：${item.aiSummary || "无"}`;
  const itemContext = [
    `标题：${item.title}`,
    `类型：${item.type}`,
    `整理状态：${item.processStatus}`,
    `阅读状态：${item.readingStatus}`,
    `标签：${item.tags.join("，") || "无"}`,
    item.sourceUrl ? `网址：${item.sourceUrl}` : "",
    fileName ? `本地附件：${fileName}` : "",
    itemBodyLine,
    authorizedFileText
      ? `用户已点击授权读取的本地文件正文（仅用于本次 AI 操作）：\n${authorizedFileText}`
      : item.filePath
        ? "本地附件正文：未授权读取，不能推测文件内容。"
        : "",
    context.imageDataUrl
      ? `用户已点击授权读取的本地图片（仅用于本次 AI 操作）：${context.fileName || getFileNameFromPath(item.filePath)}，MIME：${context.imageMimeType || "unknown"}`
      : "",
    context.sourceStatus ? `读取预检：${context.sourceStatus}` : "",
    context.fileWarnings?.length ? `本地文件读取提示：${context.fileWarnings.join("；")}` : "",
    existingSummaryLine,
    hasAuthorizedFileSource
      ? "Source rule: use the authorized local file/image content as the only source for document facts. The item body, file name, path, and existing summary are metadata only; do not use them to fill missing document content."
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompts: Record<AiAction, string> = {
    summarize:
      "请用中文为这个知识库条目生成 80 到 160 字摘要。只输出摘要正文，不要加标题。",
    title:
      "请用中文生成一个清晰短标题，20 个汉字以内。只输出标题，不要引号和解释。",
    tags:
      '请生成 3 到 6 个中文标签。只输出 JSON 字符串数组，例如 ["AI","论文"]。',
    todos:
      "请从内容里提取可执行待办。只输出 JSON 字符串数组；如果没有待办，输出 []。",
  };

  return [
    {
      role: "system",
      content:
        "你是个人知识库整理助手。回答必须简洁、准确，按用户要求的格式输出，不要编造不存在的文件内容。",
    },
    {
      role: "user",
      content: context.imageDataUrl
        ? [
            {
              type: "text",
              text: `${prompts[action]}\n\n请直接观察随附图片，不要只依据文件名或路径推测。\n\n${itemContext}`,
            },
            {
              type: "image_url",
              image_url: {
                url: context.imageDataUrl,
              },
            },
          ]
        : `${prompts[action]}\n\n${itemContext}`,
    },
  ];
}

function formatJournalEntries(entries: JournalEntry[]) {
  return entries
    .map((entry) => {
      const todos = entry.todos.length > 0 ? `\n待办：${entry.todos.join("；")}` : "";
      const tags = entry.tags.length > 0 ? `\n标签：${entry.tags.join("，")}` : "";
      return `【${entry.entryDate}】${tags}${todos}\n${entry.content}`;
    })
    .join("\n\n---\n\n");
}

function cleanTitle(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/```$/i, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/^标题[:：]\s*/, "")
    .trim()
    .slice(0, 48);
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

function formatStreamFailure(error: unknown, prefix: string) {
  const detail =
    error instanceof Error && error.message
      ? `原因：${getSafeErrorMessage(error, "流式连接异常。")}`
      : "原因：流式连接异常。";
  return `${prefix}${detail}`;
}

function extractMarkdownTitle(value: string) {
  const firstHeading = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.startsWith("#"));
  if (!firstHeading) return "";
  return cleanTitle(firstHeading.replace(/^#+\s*/, ""));
}

function formatConversationSource(input: Pick<ConversationReviewInput, "reviewKind" | "sourceKinds">) {
  if (input.reviewKind === "combined") return "综合";
  if (input.sourceKinds.includes("claude") && input.sourceKinds.includes("codex")) return "AI 对话";
  if (input.sourceKinds.includes("claude")) return "Claude Code";
  return "Codex";
}

function getFileNameFromPath(path?: string) {
  if (!path) return "";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "";
}

function parseListOutput(value: string) {
  const trimmed = stripCodeFence(value);

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    }
  } catch {
    // Fall through to forgiving text parsing.
  }

  return trimmed
    .split(/[\n,，、]/)
    .map((item) => item.replace(/^[-*•\d.、\s]+/, "").trim())
    .filter(Boolean);
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(stripCodeFence(value)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as Record<string, unknown>;
}

function parseJsonArray(value: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(stripCodeFence(value)) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function createLocalTitle(content: string) {
  return Array.from(content.replace(/\s+/g, " ").trim() || "日志沉淀").slice(0, 18).join("");
}
