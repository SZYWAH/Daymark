import type {
  AiAction,
  AiActionContext,
  AiProtocol,
  AiReasoningEffort,
  AiSettings,
  AnthropicAuthMode,
  CodexDailyReview,
  CodexReviewInput,
  ConversationReviewInput,
  ConversationSessionDelta,
  ConversationSourceKind,
  DailyConversationReview,
  Item,
  JournalEntry,
  MemorySuggestionCheckpointV1,
  ReviewGenerationTaskCheckpointV1,
  SummaryReport,
} from "../types";
import { resolveAiSettingsForRequest } from "../lib/aiSecrets";
import {
  shouldCreateMemorySuggestion,
  updateMemorySuggestionCheckpoint,
} from "../lib/memorySuggestion";
import { getSafeErrorMessage } from "../lib/redaction";
import {
  classifyReviewRequestFailure,
  createReviewSegmentId,
  createReviewSettingsFingerprint,
  getReviewCheckpointExpiry,
  waitForReviewRetry,
} from "../lib/reviewGenerationTask";
import {
  type AiInputContentBlock,
  type AiInputMessage,
  type DesktopAiGenerateRequest,
  type AiModelOption,
  hasDesktopAiTransport,
  requestDesktopAiModels,
  requestDesktopAiGeneration,
  streamDesktopAiGeneration,
} from "../lib/aiTransport";

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
  role: "system" | "user" | "assistant";
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

type AnthropicMessageResponse = {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string };
};

type AnthropicStreamEvent = {
  type?: string;
  delta?: { type?: string; text?: string };
  error?: { message?: string };
};

type OpenAiResponsesResponse = {
  output_text?: string;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  status?: string;
  incomplete_details?: { reason?: string };
  error?: { message?: string };
};

type OpenAiResponsesStreamEvent = {
  type?: string;
  delta?: string;
  text?: string;
  item?: {
    content?: Array<{ type?: string; text?: string }>;
  };
  response?: OpenAiResponsesResponse;
  choices?: ChatCompletionStreamChunk["choices"];
  error?: { message?: string };
};

type ModelsResponse = {
  data?: Array<{
    id?: string;
    supported_reasoning_efforts?: string[];
  }>;
  error?: { message?: string };
};

type NormalizedAiPrompt = {
  system?: string;
  messages: AiInputMessage[];
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
const ROLLING_REVIEW_CHUNK_CHARS = 8_000;
const REVIEW_CHUNK_TIMEOUT_MS = 120_000;
const REVIEW_SYNTHESIS_MAX_SUMMARIES = 8;
const REVIEW_COMPACTION_GROUP_SIZE = 8;

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

export type RollingWorkReviewUpdateInput = {
  date: string;
  currentContent: string;
  sourceKinds: ConversationSourceKind[];
  deltas: ConversationSessionDelta[];
  processedSessionCount: number;
  processedChars: number;
  redacted: boolean;
  truncated: boolean;
};

export type CodexReviewProgressStage =
  | "读取会话"
  | "本地脱敏"
  | "整理内容"
  | "调整分段"
  | "整理摘要"
  | "生成回顾"
  | "整理长期记忆建议"
  | "分析长期记忆"
  | "稳定完成";

export type CodexReviewProgress = {
  stage: CodexReviewProgressStage;
  message: string;
  partialContent?: string;
  indicator?: {
    mode: "indeterminate" | "determinate" | "completed";
    percent?: number;
  };
};

export type ReviewGenerationTaskHooks = {
  checkpoint: ReviewGenerationTaskCheckpointV1;
  onCheckpoint: (checkpoint: ReviewGenerationTaskCheckpointV1) => Promise<void> | void;
};

export type ReviewChunkAttempt = {
  chunk: string;
  originalIndex: number;
  originalTotal: number;
  retryPart?: "a" | "b";
};

export type ReviewChunkProgress = {
  kind: "summary" | "retry";
  attempt: ReviewChunkAttempt;
  completedCount: number;
};

export type MemoryPatchSuggestion = {
  title: string;
  rationale: string;
  proposedContent: string;
  shouldCreate: boolean;
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
  if (settings.provider === "openai-compatible") {
    return settings.customProviderName?.trim() || "OpenAI 兼容模型";
  }
  return settings.provider === "anthropic-messages" ? "Anthropic Messages" : "DeepSeek";
}

export function getEffectiveAiSettings(settings: AiSettings): EffectiveAiSettings {
  const isDeepSeek = settings.provider === "deepseek";
  const envApiKey = isDeepSeek && settings.useEnvKey ? import.meta.env.VITE_DEEPSEEK_API_KEY?.trim() : "";
  const manualApiKey = settings.manualApiKey?.trim();
  const apiKey = envApiKey || manualApiKey || "";
  const hasStoredManualKey = Boolean(settings.manualKeyStored);

  return {
    ...settings,
    provider: settings.provider === "anthropic-messages"
      ? "anthropic-messages"
      : isDeepSeek
        ? "deepseek"
        : "openai-compatible",
    protocol: settings.provider === "anthropic-messages"
      ? "anthropic-messages"
      : settings.provider === "openai-compatible" && settings.protocol === "openai-responses"
        ? "openai-responses"
        : "openai-chat-completions",
    reasoningEffort: REASONING_EFFORTS.has(settings.reasoningEffort as Exclude<AiReasoningEffort, "default">)
      ? settings.reasoningEffort
      : "default",
    anthropicAuthMode: settings.anthropicAuthMode === "bearer" ? "bearer" : "x-api-key",
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
    throw new Error("当前模型未开启图片分析能力，请在设置页确认供应商和模型支持视觉后开启该能力。");
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

  const chunkSummaries = await summarizeReviewChunksWithTimeoutFallback(
    chunks,
    async (attempt) => callDeepSeek(
      settings,
      [
        {
          role: "system",
          content:
            "你是 Codex 对话整理助手。请把这一段对话压缩成中文阶段摘要，保留工作内容、关键决定、未完成事项和用户偏好。不要记录密钥、token、长路径或一次性命令输出。",
        },
        {
          role: "user",
          content: `日期：${input.date}\n片段：${formatReviewChunkLabel(attempt)}\n\n${attempt.chunk}`,
        },
      ],
      { maxTokens: 1100, timeoutMs: REVIEW_CHUNK_TIMEOUT_MS },
    ),
  );

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
  const title = cleanTitle(String(parsed.title ?? `${input.date} Codex 回顾`));
  const normalized = normalizeReviewOutput(String(parsed.content ?? content), title);
  return {
    title: normalized.title,
    content: normalized.content,
  };
}

type ReviewCheckpointController = {
  readonly current?: ReviewGenerationTaskCheckpointV1;
  update: (patch: Partial<ReviewGenerationTaskCheckpointV1>) => Promise<void>;
};

function createReviewCheckpointController(taskHooks?: ReviewGenerationTaskHooks): ReviewCheckpointController {
  let current = taskHooks?.checkpoint;
  return {
    get current() {
      return current;
    },
    async update(patch) {
      if (!current || !taskHooks) return;
      current = { ...current, ...patch };
      await taskHooks.onCheckpoint(current);
    },
  };
}

export async function runReliableReviewTextRequest(
  request: () => Promise<string>,
  options: {
    signal?: AbortSignal;
    onRetry?: (kind: "transient" | "split-worthy", retryIndex: number) => Promise<void> | void;
    retryDelaysMs?: [number, number];
  } = {},
) {
  let transientRetries = 0;
  let splitWorthyRetries = 0;

  while (true) {
    if (options.signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
    try {
      const result = (await request()).trim();
      if (!result) throw new Error("AI 返回内容为空或格式不兼容。");
      return result;
    } catch (error) {
      const kind = classifyReviewRequestFailure(error);
      if (kind === "cancelled") throw error;
      if (kind === "transient" && transientRetries < 2) {
        const retryIndex = transientRetries;
        transientRetries += 1;
        await options.onRetry?.("transient", transientRetries);
        const delays = options.retryDelaysMs ?? [2_000, 6_000];
        await waitForReviewRetry(delays[retryIndex], options.signal);
        continue;
      }
      if (kind === "split-worthy" && splitWorthyRetries < 1) {
        splitWorthyRetries += 1;
        await options.onRetry?.("split-worthy", splitWorthyRetries);
        continue;
      }
      throw error;
    }
  }
}

async function summarizeConversationChunksWithCheckpoint(
  chunks: string[],
  input: ConversationReviewInput,
  settings: AiSettings,
  settingsFingerprint: string,
  checkpoint: ReviewCheckpointController,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
) {
  const summaries: string[] = [];
  const total = chunks.length;

  const persistRetry = async () => {
    await checkpoint.update({ retryCount: (checkpoint.current?.retryCount ?? 0) + 1 });
  };
  const summarizeAttempt = (attempt: ReviewChunkAttempt) => runReliableReviewTextRequest(
    () => callDeepSeek(
      settings,
      [
        {
          role: "system",
          content:
            "你是 AI 对话整理助手。请把这一段对话压缩成中文阶段摘要，保留工作内容、关键决定、未完成事项和稳定偏好。正文中如出现“前序上下文，仅用于理解，不计入本次回顾”，只能将它用作背景，不得把其中已完成事项算入本次日期的成果。不要记录密钥、token、长路径、工具原始输出或一次性命令输出。",
        },
        {
          role: "user",
          content: `日期：${formatConversationActivityRange(input)}\n来源：${formatConversationSource(input)}\n片段：${formatReviewChunkLabel(attempt)}\n\n${attempt.chunk}`,
        },
      ],
      { maxTokens: 1100, timeoutMs: REVIEW_CHUNK_TIMEOUT_MS, signal },
    ),
    { signal, onRetry: persistRetry },
  );

  for (const [index, chunk] of chunks.entries()) {
    if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
    const attempt: ReviewChunkAttempt = { chunk, originalIndex: index, originalTotal: total };
    const directId = await createReviewSegmentId("chunk", chunk, settingsFingerprint);
    const direct = checkpoint.current?.chunkSummaries.find((item) => item.id === directId);
    if (direct) {
      summaries.push(direct.summary);
      await checkpoint.update({ completedChunkCount: index + 1, stage: "summarizing" });
      onProgress({ stage: "整理内容", message: `已恢复第 ${index + 1}/${total} 段。` });
      continue;
    }

    const retryChunks = splitReviewChunkForRetry(chunk);
    const retryIds = await Promise.all(retryChunks.map((part) => createReviewSegmentId("chunk", part, settingsFingerprint)));
    const storedRetryParts = retryIds.map((id) => checkpoint.current?.chunkSummaries.find((item) => item.id === id));
    if (retryChunks.length === 2 && storedRetryParts.every(Boolean)) {
      summaries.push(...storedRetryParts.map((item) => item!.summary));
      await checkpoint.update({ completedChunkCount: index + 1, stage: "summarizing" });
      onProgress({ stage: "整理内容", message: `已恢复第 ${index + 1}/${total} 段的两个子段。` });
      continue;
    }

    const hasPartialSplitCheckpoint = retryChunks.length === 2 && storedRetryParts.some(Boolean);
    if (!hasPartialSplitCheckpoint) {
      onProgress({ stage: "整理内容", message: `正在整理第 ${index + 1}/${total} 段。` });
      try {
        const summary = await summarizeAttempt(attempt);
        const nextSummaries = [
          ...(checkpoint.current?.chunkSummaries ?? []).filter((item) => item.id !== directId),
          { id: directId, originalIndex: index, originalTotal: total, summary },
        ];
        summaries.push(summary);
        await checkpoint.update({
          stage: "summarizing",
          completedChunkCount: index + 1,
          chunkSummaries: nextSummaries,
          lastError: undefined,
        });
        continue;
      } catch (error) {
        if (signal?.aborted || classifyReviewRequestFailure(error) !== "split-worthy") {
          const detail = getSafeErrorMessage(error, "AI 请求失败。");
          await checkpoint.update({ lastError: `分段整理第 ${index + 1}/${total} 段失败：${detail}` });
          throw new Error(`分段整理第 ${index + 1}/${total} 段未完成。${detail}`);
        }
      }
    } else {
      onProgress({ stage: "调整分段", message: `正在从第 ${index + 1}/${total} 段未完成的子段继续。` });
    }

    if (!hasPartialSplitCheckpoint) {
      onProgress({ stage: "调整分段", message: `第 ${index + 1}/${total} 段响应异常，正在拆分为两段。` });
    }
    if (retryChunks.length < 2) {
      throw new Error(`分段整理第 ${index + 1}/${total} 段未完成，且无法继续拆分。`);
    }
    const partSummaries: string[] = [];
    for (const [partIndex, retryChunk] of retryChunks.entries()) {
      const retryPart = partIndex === 0 ? "a" : "b";
      const retryId = retryIds[partIndex];
      const stored = checkpoint.current?.chunkSummaries.find((item) => item.id === retryId);
      if (stored) {
        partSummaries.push(stored.summary);
        continue;
      }
      const retryAttempt: ReviewChunkAttempt = { ...attempt, chunk: retryChunk, retryPart };
      onProgress({ stage: "整理内容", message: `正在整理第 ${index + 1}/${total} 段的子段 ${retryPart}。` });
      try {
        const summary = await summarizeAttempt(retryAttempt);
        partSummaries.push(summary);
        await checkpoint.update({
          stage: "summarizing",
          chunkSummaries: [
            ...(checkpoint.current?.chunkSummaries ?? []).filter((item) => item.id !== retryId),
            { id: retryId, originalIndex: index, originalTotal: total, retryPart, summary },
          ],
          lastError: undefined,
        });
      } catch (error) {
        const detail = getSafeErrorMessage(error, "AI 请求失败。");
        await checkpoint.update({ lastError: `分段整理第 ${index + 1}/${total} 段的子段 ${retryPart} 失败：${detail}` });
        throw new Error(`分段整理第 ${index + 1}/${total} 段的子段 ${retryPart} 未完成。${detail}`);
      }
    }
    summaries.push(...partSummaries);
    await checkpoint.update({ completedChunkCount: index + 1, stage: "summarizing" });
  }

  return summaries;
}

export async function streamSummarizeConversationReview(
  input: ConversationReviewInput,
  settings: AiSettings,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
  taskHooks?: ReviewGenerationTaskHooks,
): Promise<JournalSummaryResult> {
  const chunks = input.transcriptChunks.filter((chunk) => chunk.trim());
  if (chunks.length === 0) {
    throw new Error("这一天没有可用于回顾的 AI 对话内容。");
  }

  const checkpoint = createReviewCheckpointController(taskHooks);
  const settingsFingerprint = await createReviewSettingsFingerprint(settings);
  const checkpointMatchesSettings = !checkpoint.current
    || checkpoint.current.settingsFingerprint === settingsFingerprint;
  await checkpoint.update({
    settingsFingerprint,
    stage: "summarizing",
    totalChars: input.totalChars,
    chunkCount: chunks.length,
    completedChunkCount: checkpointMatchesSettings ? checkpoint.current?.completedChunkCount ?? 0 : 0,
    chunkSummaries: checkpointMatchesSettings ? checkpoint.current?.chunkSummaries ?? [] : [],
    compactionSummaries: checkpointMatchesSettings ? checkpoint.current?.compactionSummaries ?? [] : [],
    compactionLevel: checkpointMatchesSettings ? checkpoint.current?.compactionLevel ?? 0 : 0,
    compactionGroupIndex: checkpointMatchesSettings ? checkpoint.current?.compactionGroupIndex ?? 0 : 0,
    finalTitle: checkpointMatchesSettings ? checkpoint.current?.finalTitle : undefined,
    finalContent: checkpointMatchesSettings ? checkpoint.current?.finalContent : undefined,
    lastError: undefined,
  });

  onProgress({
    stage: "本地脱敏",
    message: input.redacted ? "已在本机替换疑似密钥与凭据。" : "未发现明显需要脱敏的内容。",
  });

  const chunkSummaries = await summarizeConversationChunksWithCheckpoint(
    chunks,
    input,
    settings,
    settingsFingerprint,
    checkpoint,
    onProgress,
    signal,
  );

  const synthesisSummaries = await compactConversationReviewSummaries(
    input,
    chunkSummaries,
    settings,
    onProgress,
    signal,
    settingsFingerprint,
    checkpoint,
  );
  const messages = buildConversationReviewSynthesisMessages(input, synthesisSummaries);
  if (checkpoint.current?.finalTitle && checkpoint.current.finalContent) {
    return {
      title: checkpoint.current.finalTitle,
      content: checkpoint.current.finalContent,
    };
  }
  await checkpoint.update({ stage: "synthesizing", lastError: undefined });
  onProgress({ stage: "生成回顾", message: "正在生成回顾。" });

  let streamed = "";
  try {
    streamed = await callDeepSeekStream(
      settings,
      messages,
      (token, fullText) => {
        onProgress({
          stage: "生成回顾",
          message: "回顾正在生成。",
          partialContent: fullText,
        });
      },
      { maxTokens: 2200, signal },
    );
  } catch (streamError) {
    if (signal?.aborted) throw streamError;
    onProgress({
      stage: "稳定完成",
      message: "正在以稳定方式完成回顾。",
    });
    try {
      streamed = await runReliableReviewTextRequest(
        () => callDeepSeek(settings, messages, {
          maxTokens: 2200,
          timeoutMs: AI_STREAM_TIMEOUT_MS,
          signal,
        }),
        {
          signal,
          onRetry: async () => {
            await checkpoint.update({ retryCount: (checkpoint.current?.retryCount ?? 0) + 1 });
          },
        },
      );
      onProgress({
        stage: "生成回顾",
        message: "回顾已生成。",
        partialContent: streamed,
      });
    } catch (fallbackError) {
      throw new Error(formatStreamFailure(
        fallbackError,
        "回顾未生成，当前回顾未被改写。可稍后重试。",
      ));
    }
  }

  const normalized = normalizeReviewOutput(streamed, `${input.date} ${formatConversationSource(input)}回顾`);
  await checkpoint.update({
    stage: "memory-suggestion",
    finalTitle: normalized.title,
    finalContent: normalized.content,
    lastError: undefined,
  });
  return normalized;
}

export async function streamUpdateRollingWorkReview(
  input: RollingWorkReviewUpdateInput,
  settings: AiSettings,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
): Promise<JournalSummaryResult> {
  const deltas = input.deltas.filter((delta) => delta.transcript.trim());
  if (deltas.length === 0) {
    throw new Error("没有新的 AI 对话内容可用于更新今日工作内容。");
  }

  onProgress({
    stage: "本地脱敏",
    message: input.redacted ? "新增对话已在本机完成脱敏。" : "新增对话未发现明显敏感内容。",
  });

  const deltaText = deltas.map(formatRollingWorkDelta).join("\n\n---\n\n");
  const chunks = chunkPlainText(deltaText, ROLLING_REVIEW_CHUNK_CHARS);
  const deltaContext: string[] = [];

  if (chunks.length <= 1) {
    deltaContext.push(deltaText);
  } else {
    deltaContext.push(...await summarizeReviewChunksWithTimeoutFallback(
      chunks,
      async (attempt) => callDeepSeek(
        settings,
        [
          {
            role: "system",
            content:
              "你是个人工作日志的增量整理助手。请把新增 AI 对话片段压缩成中文要点，保留已完成事项、正在进行、关键决策、问题风险、待办和可沉淀为长期记忆的候选。不要记录密钥、token、临时路径或原始命令输出。",
          },
          {
            role: "user",
            content: `日期：${input.date}\n片段：${formatReviewChunkLabel(attempt)}\n\n${attempt.chunk}`,
          },
        ],
        { maxTokens: 1000, timeoutMs: REVIEW_CHUNK_TIMEOUT_MS, signal },
      ),
      {
        signal,
        onProgress: (progress) => {
          if (progress.kind === "retry") {
            onProgress({
            stage: "调整分段",
              message: `第 ${formatReviewChunkLabel(progress.attempt)} 个新增片段响应较慢，正在拆分为两段。`,
            });
            return;
          }
          const retryLabel = progress.attempt.retryPart
            ? `，正在重试子段 ${progress.attempt.retryPart}`
            : "";
          onProgress({
          stage: "整理内容",
            message: `正在整理新增片段 ${formatReviewChunkLabel(progress.attempt)}${retryLabel}。`,
          });
        },
      },
    ));
  }

  onProgress({ stage: "生成回顾", message: "正在更新今日工作内容。" });
  const messages = buildRollingWorkReviewMessages(input, deltaContext);
  let streamed = "";
  try {
    streamed = await callDeepSeekStream(
      settings,
      messages,
      (_token, fullText) => {
        onProgress({
          stage: "生成回顾",
          message: "今日工作内容正在更新。",
          partialContent: fullText,
        });
      },
      { maxTokens: 2600, signal },
    );
  } catch (streamError) {
    if (signal?.aborted) throw streamError;
    onProgress({
      stage: "稳定完成",
      message: "正在以稳定方式更新今日工作内容。",
    });
    try {
      streamed = await callDeepSeek(settings, messages, {
        maxTokens: 2600,
        timeoutMs: AI_STREAM_TIMEOUT_MS,
        signal,
      });
      onProgress({
        stage: "生成回顾",
        message: "今日工作内容已更新。",
        partialContent: streamed,
      });
    } catch (fallbackError) {
      throw new Error(formatStreamFailure(
        fallbackError,
        "今日工作内容未更新，已有内容保持不变。可稍后重试。",
      ));
    }
  }
  return normalizeReviewOutput(streamed, `${input.date} 今日工作内容`);
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

export type MemorySuggestionTaskHooks = {
  readonly checkpoint: MemorySuggestionCheckpointV1;
  onCheckpoint: (checkpoint: MemorySuggestionCheckpointV1) => Promise<void> | void;
};

export async function streamGenerateMemoryPatchFromReview(
  review: DailyConversationReview,
  currentMemory: string,
  settings: AiSettings,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
  taskHooks?: MemorySuggestionTaskHooks,
): Promise<MemoryPatchSuggestion> {
  let checkpoint = taskHooks?.checkpoint;
  const persistCheckpoint = async (patch: Partial<MemorySuggestionCheckpointV1>) => {
    if (!checkpoint || !taskHooks) return;
    checkpoint = updateMemorySuggestionCheckpoint(checkpoint, patch);
    await taskHooks.onCheckpoint(checkpoint);
  };
  const messages = buildMemoryPatchMessages(review, currentMemory);
  onProgress({ stage: "分析长期记忆", message: "正在分析长期记忆建议。" });

  let streamError: unknown;
  try {
    await persistCheckpoint({
      status: "running",
      executionMode: "stream",
      attemptCount: (checkpoint?.attemptCount ?? 0) + 1,
      lastError: undefined,
    });
    const content = await callDeepSeekStream(
      settings,
      messages,
      (_token, fullText) => {
        onProgress({
          stage: "分析长期记忆",
          message: "正在生成长期记忆建议。",
          partialContent: fullText,
        });
      },
      { maxTokens: 2600, signal },
    );
    return parseMemoryPatchSuggestion(content, currentMemory);
  } catch (error) {
    if (signal?.aborted) throw error;
    const kind = classifyReviewRequestFailure(error);
    await persistCheckpoint({
      lastError: getSafeErrorMessage(error, "长期记忆建议暂未完成。"),
    });
    if (kind === "cancelled" || kind === "configuration" || kind === "fatal") throw error;
    streamError = error;
  }

  onProgress({ stage: "分析长期记忆", message: "流式生成未完成，正在以稳定方式重试。" });
  let lastError = streamError;
  const retryDelays = [0, 2_000, 6_000] as const;
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
    if (retryDelays[attempt] > 0) {
      await persistCheckpoint({ retryCount: (checkpoint?.retryCount ?? 0) + 1 });
      await waitForReviewRetry(retryDelays[attempt], signal);
    }
    await persistCheckpoint({
      status: "running",
      executionMode: "non-stream",
      attemptCount: (checkpoint?.attemptCount ?? 0) + 1,
      lastError: undefined,
    });
    try {
      const content = await callDeepSeek(settings, messages, {
        maxTokens: 2600,
        timeoutMs: AI_STREAM_TIMEOUT_MS,
        signal,
      });
      return parseMemoryPatchSuggestion(content, currentMemory);
    } catch (error) {
      lastError = error;
      await persistCheckpoint({
        lastError: getSafeErrorMessage(error, "长期记忆建议暂未完成。"),
      });
      const kind = classifyReviewRequestFailure(error);
      if (kind === "cancelled" || kind === "configuration" || kind === "fatal") throw error;
      if (attempt === retryDelays.length - 1) throw error;
      onProgress({
        stage: "分析长期记忆",
        message: `长期记忆建议暂未完成，正在进行第 ${attempt + 1} 次重试。`,
      });
    }
  }
  throw lastError;
}

function parseMemoryPatchSuggestion(content: string, currentMemory: string): MemoryPatchSuggestion {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseJsonObject(content);
  } catch {
    throw new Error("AI 返回内容为空或格式不兼容。");
  }
  const action = String(parsed.action ?? "").trim().toLowerCase();
  if (action !== "create" && action !== "none") {
    throw new Error("AI 返回内容为空或格式不兼容。");
  }
  const proposedContent = String(parsed.proposedContent ?? "").trim();
  if (action === "create" && !proposedContent) {
    throw new Error("AI 返回内容为空或格式不兼容。");
  }
  const shouldCreate = shouldCreateMemorySuggestion(action, proposedContent || currentMemory, currentMemory);
  return {
    title: cleanTitle(String(parsed.title ?? "长期记忆建议")) || "长期记忆建议",
    rationale: String(parsed.rationale ?? (shouldCreate ? "根据本次回顾整理出的长期记忆建议。" : "本次未发现需要长期保留的新信息。")).trim(),
    proposedContent: shouldCreate ? proposedContent : currentMemory,
    shouldCreate,
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

  onProgress({ stage: "生成回顾", message: "正在生成今日回顾。" });
  let streamed = "";
  try {
    streamed = await callDeepSeekStream(
      settings,
      messages,
      (_token, fullText) =>
        onProgress({ stage: "生成回顾", message: "今日回顾正在生成。", partialContent: fullText }),
      { maxTokens: 2200, signal },
    );
  } catch (error) {
    if (signal?.aborted) throw error;
    onProgress({ stage: "稳定完成", message: "今日回顾未生成，当前回顾未被改写。可稍后重试。" });
    throw new Error(formatStreamFailure(error, "今日回顾未生成，当前回顾未被改写。可稍后重试。"));
  }

  return normalizeReviewOutput(streamed, `${date} 今日总回顾`);
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

export function buildChatCompletionsEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }

  return `${trimmed}/chat/completions`;
}

export function buildAnthropicMessagesEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/messages")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/messages`;
  return `${trimmed}/v1/messages`;
}

export function buildOpenAiResponsesEndpoint(baseUrl: string) {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/responses")) return trimmed;
  if (trimmed.endsWith("/v1")) return `${trimmed}/responses`;
  return `${trimmed}/responses`;
}

export function buildOpenAiModelEndpoints(baseUrl: string) {
  const url = new URL(baseUrl.trim());
  let path = url.pathname.replace(/\/+$/, "");
  path = path.replace(/\/(?:chat\/completions|responses)$/i, "").replace(/\/+$/, "");
  const endsWithV1 = /\/v1$/i.test(path);
  const primaryPath = endsWithV1 ? `${path}/models` : `${path}/v1/models`;
  const fallbackBase = endsWithV1 ? path.replace(/\/v1$/i, "") : path;
  const fallbackPath = `${fallbackBase}/models`;
  return [...new Set([primaryPath, fallbackPath].map((pathname) => {
    const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return new URL(normalizedPath, url.origin).toString().replace(/\/$/, "");
  }))];
}

const REASONING_EFFORTS = new Set<Exclude<AiReasoningEffort, "default">>([
  "none", "minimal", "low", "medium", "high", "xhigh",
]);

export function parseModelListResponse(data: ModelsResponse): AiModelOption[] {
  const byId = new Map<string, AiModelOption>();
  for (const item of data.data ?? []) {
    const id = item.id?.trim();
    if (!id) continue;
    const efforts = item.supported_reasoning_efforts
      ?.filter((value): value is Exclude<AiReasoningEffort, "default"> =>
        REASONING_EFFORTS.has(value as Exclude<AiReasoningEffort, "default">));
    byId.set(id, {
      id,
      ...(efforts?.length ? { supportedReasoningEfforts: [...new Set(efforts)] } : {}),
    });
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchAvailableAiModels(settings: AiSettings): Promise<AiModelOption[]> {
  const effective = getEffectiveAiSettings(await resolveAiSettingsForRequest(settings));
  if (effective.provider !== "openai-compatible") {
    throw new Error("仅 OpenAI 兼容自定义供应商支持获取模型列表。");
  }
  if (!effective.apiKey) throw new Error("请先输入或保存当前 Base URL 对应的 API Key。");

  if (hasDesktopAiTransport()) {
    return requestDesktopAiModels({ baseUrl: effective.baseUrl, apiKey: effective.apiKey, timeoutMs: 30_000 });
  }

  const endpoints = buildOpenAiModelEndpoints(effective.baseUrl);
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${effective.apiKey}` },
      });
      const data = (await response.json().catch(() => ({}))) as ModelsResponse;
      if (!response.ok) {
        const error = new Error(data.error?.message || `获取模型失败（HTTP ${response.status}）。`);
        if (response.status === 404) {
          lastError = error;
          continue;
        }
        throw error;
      }
      const models = parseModelListResponse(data);
      if (!models.length) throw new Error("模型接口返回了空列表或不兼容的数据格式。");
      return models;
    } catch (error) {
      lastError = error;
      if (!(error instanceof TypeError)) throw error;
      break;
    }
  }
  throw new Error(getSafeErrorMessage(lastError, "无法获取模型列表；Web 模式还可能受到 CORS 限制。"));
}

export function getAiProtocol(settings: Pick<AiSettings, "provider" | "protocol">): AiProtocol {
  if (settings.provider === "anthropic-messages") return "anthropic-messages";
  if (settings.provider === "openai-compatible" && settings.protocol === "openai-responses") {
    return "openai-responses";
  }
  return "openai-chat-completions";
}

export function normalizeAiPrompt(messages: ChatMessage[]): NormalizedAiPrompt {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => extractTextContent(message.content))
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const normalizedMessages = messages
    .filter((message) => message.role !== "system")
    .map((message): AiInputMessage => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: normalizeContentBlocks(message.content),
    }))
    .filter((message) => message.content.length > 0);

  return {
    system: system || undefined,
    messages: normalizedMessages,
  };
}

function extractTextContent(content: ChatMessageContent) {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is Extract<(typeof content)[number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function normalizeContentBlocks(content: ChatMessageContent): AiInputContentBlock[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  return content.map((block): AiInputContentBlock => {
    if (block.type === "text") return { type: "text", text: block.text };
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(block.image_url.url);
    if (!match || !match[1].toLowerCase().startsWith("image/")) {
      throw new Error("图片消息必须来自 Daymark 已明确读取的本地图片。");
    }
    return { type: "image", mediaType: match[1].toLowerCase(), data: match[2] };
  });
}

function createAiGenerateRequest(
  effective: EffectiveAiSettings,
  messages: ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
): DesktopAiGenerateRequest {
  const protocol = getAiProtocol(effective);
  const prompt = normalizeAiPrompt(messages);
  return {
    protocol,
    endpoint: protocol === "anthropic-messages"
      ? buildAnthropicMessagesEndpoint(effective.baseUrl)
      : protocol === "openai-responses"
        ? buildOpenAiResponsesEndpoint(effective.baseUrl)
        : buildChatCompletionsEndpoint(effective.baseUrl),
    apiKey: effective.apiKey,
    authMode: effective.anthropicAuthMode === "bearer" ? "bearer" : "x-api-key",
    model: effective.model,
    system: prompt.system,
    messages: prompt.messages,
    temperature: protocol === "openai-chat-completions" ? 0.2 : undefined,
    maxTokens,
    reasoningEffort: protocol === "openai-responses" && effective.reasoningEffort && effective.reasoningEffort !== "default"
      ? effective.reasoningEffort as Exclude<AiReasoningEffort, "default">
      : undefined,
    timeoutMs,
  };
}

export function buildBrowserAiRequest(request: DesktopAiGenerateRequest, stream: boolean) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (request.protocol === "anthropic-messages") {
    headers[request.authMode === "bearer" ? "Authorization" : "x-api-key"] =
      request.authMode === "bearer" ? `Bearer ${request.apiKey}` : request.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    return {
      headers,
      body: {
        model: request.model,
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content.map((block) => block.type === "text"
            ? { type: "text", text: block.text }
            : {
                type: "image",
                source: { type: "base64", media_type: block.mediaType, data: block.data },
              }),
        })),
        stream,
        max_tokens: request.maxTokens,
      },
    };
  }

  if (request.protocol === "openai-responses") {
    headers.Authorization = `Bearer ${request.apiKey}`;
    return {
      headers,
      body: {
        model: request.model,
        ...(request.system ? { instructions: request.system } : {}),
        input: request.messages.map((message) => ({
          role: message.role,
          content: message.content.map((block) => block.type === "text"
            ? { type: "input_text", text: block.text }
            : {
                type: "input_image",
                image_url: `data:${block.mediaType};base64,${block.data}`,
                detail: "auto",
              }),
        })),
        stream,
        store: false,
        ...(request.reasoningEffort ? { reasoning: { effort: request.reasoningEffort } } : {}),
      },
    };
  }

  headers.Authorization = `Bearer ${request.apiKey}`;
  return {
    headers,
    body: {
      model: request.model,
      messages: [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        ...request.messages.map((message) => ({
          role: message.role,
          content: toOpenAiContent(message.content),
        })),
      ],
      stream,
      ...(request.temperature == null ? {} : { temperature: request.temperature }),
      max_tokens: request.maxTokens,
    },
  };
}

function toOpenAiContent(content: AiInputContentBlock[]) {
  if (content.every((block) => block.type === "text")) {
    return content.map((block) => block.type === "text" ? block.text : "").join("\n");
  }
  return content.map((block) => block.type === "text"
    ? { type: "text", text: block.text }
    : { type: "image_url", image_url: { url: `data:${block.mediaType};base64,${block.data}` } });
}

export function extractResponsesContent(data: OpenAiResponsesResponse) {
  const topLevel = data.output_text?.trim();
  if (topLevel) return topLevel;
  return data.output
    ?.flatMap((item) => item.content ?? [])
    .filter((block) => block.type === "output_text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("")
    .trim();
}

function extractBrowserCompletionContent(
  protocol: AiProtocol,
  data: ChatCompletionResponse | AnthropicMessageResponse | OpenAiResponsesResponse,
) {
  if (protocol === "anthropic-messages") {
    return (data as AnthropicMessageResponse).content
      ?.filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("")
      .trim();
  }
  if (protocol === "openai-responses") return extractResponsesContent(data as OpenAiResponsesResponse);
  return (data as ChatCompletionResponse).choices?.[0]?.message?.content?.trim();
}

export function extractBrowserStreamToken(
  protocol: AiProtocol,
  event: ChatCompletionStreamChunk | AnthropicStreamEvent | OpenAiResponsesStreamEvent,
  hasText = false,
) {
  if (event.error?.message) throw new Error(event.error.message);
  if (protocol === "anthropic-messages") {
    const anthropic = event as AnthropicStreamEvent;
    return anthropic.type === "content_block_delta" && anthropic.delta?.type === "text_delta"
      ? anthropic.delta.text ?? ""
      : "";
  }
  if (protocol === "openai-responses") {
    const responses = event as OpenAiResponsesStreamEvent;
    if (responses.type === "response.failed") {
      throw new Error(responses.response?.error?.message || "Responses request failed.");
    }
    if (responses.type === "response.incomplete") {
      throw new Error(responses.response?.incomplete_details?.reason || "Responses request was incomplete.");
    }
    if (responses.type === "response.output_text.delta") return responses.delta ?? "";
    if (responses.type === "response.output_text.done" && !hasText) {
      return responses.text ?? responses.delta ?? "";
    }
    if (responses.type === "response.output_item.done" && !hasText && responses.item) {
      return extractResponsesContent({ output: [responses.item] }) ?? "";
    }
    if (responses.type === "response.completed" && !hasText && responses.response) {
      return extractResponsesContent(responses.response) ?? "";
    }
    return responses.choices?.[0]?.delta?.content ?? "";
  }
  return (event as ChatCompletionStreamChunk).choices?.[0]?.delta?.content ?? "";
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
  const request = createAiGenerateRequest(effective, messages, options.maxTokens ?? 1200, timeoutMs);
  if (hasDesktopAiTransport()) {
    return requestDesktopAiGeneration(request, options.signal).catch((error) => {
      throw new Error(getSafeErrorMessage(error, `${providerLabel} 请求失败。`));
    });
  }
  const timeout = createTimeoutSignal(options.signal, timeoutMs);
  try {
    const browserRequest = buildBrowserAiRequest(request, false);
    const response = await fetch(request.endpoint, {
      method: "POST",
      signal: timeout.signal,
      headers: browserRequest.headers,
      body: JSON.stringify(browserRequest.body),
    });

    const data = (await response.json().catch(() => ({}))) as ChatCompletionResponse | AnthropicMessageResponse | OpenAiResponsesResponse;
    const content = extractBrowserCompletionContent(request.protocol, data);

    if (!response.ok) {
      throw new Error(getSafeErrorMessage(data.error?.message, `${providerLabel} 请求失败：HTTP ${response.status}`));
    }

    if (request.protocol === "openai-responses") {
      const responses = data as OpenAiResponsesResponse;
      if (responses.status === "failed") throw new Error(responses.error?.message || `${providerLabel} 请求失败。`);
      if (responses.status === "incomplete") {
        throw new Error(responses.incomplete_details?.reason || `${providerLabel} 返回未完成。`);
      }
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
  const request = createAiGenerateRequest(effective, messages, options.maxTokens ?? 1600, timeoutMs);
  if (hasDesktopAiTransport()) {
    return streamDesktopAiGeneration(request, onToken, options.signal).catch((error) => {
      throw new Error(getSafeErrorMessage(error, `${providerLabel} 流式请求失败。`));
    });
  }
  const timeout = createTimeoutSignal(options.signal, timeoutMs);
  try {
    const browserRequest = buildBrowserAiRequest(request, true);
    const response = await fetch(request.endpoint, {
      method: "POST",
      signal: timeout.signal,
      headers: browserRequest.headers,
      body: JSON.stringify(browserRequest.body),
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

        const parsed = JSON.parse(payload) as ChatCompletionStreamChunk | AnthropicStreamEvent | OpenAiResponsesStreamEvent;
        let token = "";
        try {
          token = extractBrowserStreamToken(request.protocol, parsed, Boolean(fullText));
        } catch (error) {
          throw new Error(getSafeErrorMessage(error, `${providerLabel} 流式请求失败。`));
        }
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

export function isRetryableReviewChunkTimeout(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /(?:AI 请求超时|请求超过\s*\d+\s*秒仍未返回|TimeoutError)/i.test(message);
}

export function splitReviewChunkForRetry(value: string) {
  const chars = Array.from(value);
  if (chars.length < 2) return [value];
  const midpoint = Math.ceil(chars.length / 2);
  return [
    chars.slice(0, midpoint).join(""),
    chars.slice(midpoint).join(""),
  ].filter((chunk) => chunk.trim());
}

export async function summarizeReviewChunksWithTimeoutFallback(
  chunks: string[],
  summarizeChunk: (attempt: ReviewChunkAttempt) => Promise<string>,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ReviewChunkProgress) => void;
  } = {},
): Promise<string[]> {
  const summaries: string[] = [];
  const total = chunks.length;

  for (const [index, chunk] of chunks.entries()) {
    const attempt: ReviewChunkAttempt = {
      chunk,
      originalIndex: index,
      originalTotal: total,
    };
    options.onProgress?.({ kind: "summary", attempt, completedCount: summaries.length });

    try {
      const summary = (await summarizeChunk(attempt)).trim();
      if (!summary) throw new Error("AI 返回内容为空或格式不兼容。");
      summaries.push(summary);
      continue;
    } catch (error) {
      if (options.signal?.aborted || !isRetryableReviewChunkTimeout(error)) throw error;
    }

    options.onProgress?.({ kind: "retry", attempt, completedCount: summaries.length });
    const retryChunks = splitReviewChunkForRetry(chunk);
    if (retryChunks.length < 2) {
      throw new Error(
        `第 ${formatReviewChunkLabel(attempt)} 段请求超时，且无法继续拆分；本次生成中已完成 ${summaries.length} 段。请检查连接后重试。`,
      );
    }

    for (const [retryIndex, retryChunk] of retryChunks.entries()) {
      const retryAttempt: ReviewChunkAttempt = {
        ...attempt,
        chunk: retryChunk,
        retryPart: retryIndex === 0 ? "a" : "b",
      };
      options.onProgress?.({ kind: "summary", attempt: retryAttempt, completedCount: summaries.length });
      try {
        const summary = (await summarizeChunk(retryAttempt)).trim();
        if (!summary) throw new Error("AI 返回内容为空或格式不兼容。");
        summaries.push(summary);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const detail = getSafeErrorMessage(error, "AI 请求失败。");
        throw new Error(
          `第 ${formatReviewChunkLabel(attempt)} 段拆分后仍未完成；本次生成中已完成 ${summaries.length} 段。请检查连接后重试。原因：${detail}`,
        );
      }
    }
  }

  return summaries;
}

function formatReviewChunkLabel(attempt: ReviewChunkAttempt) {
  const base = `${attempt.originalIndex + 1}/${attempt.originalTotal}`;
  return attempt.retryPart ? `${base}（${attempt.retryPart}）` : base;
}

async function requestCompactionSummary(
  input: ConversationReviewInput,
  content: string,
  label: string,
  settings: AiSettings,
  signal: AbortSignal | undefined,
  onRetry: () => Promise<void>,
  onSplit: () => void,
) {
  const request = (part: string, partLabel = label) => runReliableReviewTextRequest(
    () => callDeepSeek(
      settings,
      [
        {
          role: "system",
          content:
            "你正在压缩同一天 AI 对话的阶段摘要。请合并重复信息，保留具体完成事项、进行中的工作、关键决策、问题风险、待办和可沉淀线索。不要把跨日前序上下文中的旧成果计入当天，也不要记录密钥、token、原始路径、命令输出或工具日志。输出中文要点即可。",
        },
        {
          role: "user",
          content: [
            `日期：${formatConversationActivityRange(input)}`,
            `来源：${formatConversationSource(input)}`,
            `摘要组：${partLabel}`,
            "",
            part,
          ].join("\n"),
        },
      ],
      { maxTokens: 1200, timeoutMs: REVIEW_CHUNK_TIMEOUT_MS, signal },
    ),
    { signal, onRetry },
  );

  try {
    return await request(content);
  } catch (error) {
    if (signal?.aborted || classifyReviewRequestFailure(error) !== "split-worthy") throw error;
    const parts = splitReviewChunkForRetry(content);
    if (parts.length < 2) throw error;
    onSplit();
    const summaries: string[] = [];
    for (const [index, part] of parts.entries()) {
      summaries.push(await request(part, `${label} 子段 ${index === 0 ? "a" : "b"}`));
    }
    return summaries.join("\n\n");
  }
}

async function compactConversationReviewSummaries(
  input: ConversationReviewInput,
  summaries: string[],
  settings: AiSettings,
  onProgress: (progress: CodexReviewProgress) => void,
  signal?: AbortSignal,
  settingsFingerprint?: string,
  checkpoint?: ReviewCheckpointController,
) {
  let current = summaries.filter((summary) => summary.trim());
  let level = 1;

  while (current.length > REVIEW_SYNTHESIS_MAX_SUMMARIES) {
    const groups = groupReviewSummaries(current, REVIEW_COMPACTION_GROUP_SIZE);
    const compacted: string[] = [];

    for (const [index, group] of groups.entries()) {
      if (signal?.aborted) throw new DOMException("已取消生成。", "AbortError");
      const groupContent = group.join("\n\n---\n\n");
      const groupId = settingsFingerprint
        ? await createReviewSegmentId("compaction", `level:${level}\ngroup:${index}\n${groupContent}`, settingsFingerprint)
        : "";
      const restored = groupId
        ? checkpoint?.current?.compactionSummaries.find((item) => item.id === groupId)
        : undefined;
      if (restored) {
        compacted.push(restored.summary);
        await checkpoint?.update({
          stage: "compacting",
          compactionLevel: level,
          compactionGroupIndex: index + 1,
        });
        onProgress({
          stage: "整理摘要",
          message: `已恢复第 ${level} 层摘要 ${index + 1}/${groups.length}。`,
        });
        continue;
      }
      onProgress({
        stage: "整理摘要",
        message: `正在压缩第 ${level} 层摘要 ${index + 1}/${groups.length}，避免最终请求过大。`,
      });
      try {
        const summary = await requestCompactionSummary(
          input,
          group.map((item, itemIndex) => `【阶段摘要 ${itemIndex + 1}】\n${item}`).join("\n\n---\n\n"),
          `第 ${level} 层 ${index + 1}/${groups.length}`,
          settings,
          signal,
          async () => {
            await checkpoint?.update({ retryCount: (checkpoint.current?.retryCount ?? 0) + 1 });
          },
          () => onProgress({
            stage: "调整分段",
            message: `第 ${level} 层摘要 ${index + 1}/${groups.length} 响应异常，正在拆分处理。`,
          }),
        );
        compacted.push(summary);
        if (groupId) {
          await checkpoint?.update({
            stage: "compacting",
            compactionLevel: level,
            compactionGroupIndex: index + 1,
            compactionSummaries: [
              ...(checkpoint.current?.compactionSummaries ?? []).filter((item) => item.id !== groupId),
              { id: groupId, level, groupIndex: index, groupTotal: groups.length, summary },
            ],
            lastError: undefined,
          });
        }
      } catch (error) {
        const detail = getSafeErrorMessage(error, "AI 请求失败。");
        await checkpoint?.update({
          stage: "compacting",
          compactionLevel: level,
          compactionGroupIndex: index,
          lastError: `阶段压缩第 ${level} 层第 ${index + 1}/${groups.length} 组失败：${detail}`,
        });
        throw new Error(`阶段压缩第 ${level} 层第 ${index + 1}/${groups.length} 组未完成。${detail}`);
      }
    }

    current = compacted;
    level += 1;
  }

  return current;
}

function groupReviewSummaries(summaries: string[], groupSize: number) {
  const groups: string[][] = [];
  for (let index = 0; index < summaries.length; index += groupSize) {
    groups.push(summaries.slice(index, index + groupSize));
  }
  return groups;
}

function buildConversationReviewSynthesisMessages(input: ConversationReviewInput, chunkSummaries: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是一个安静、克制的个人工作回顾编辑。请直接输出 Markdown 正文，不要输出 JSON，不要包代码块。结构固定为：## 今日做了什么、## 关键决定、## 还悬着的事、## 值得沉淀的线索。内容要具体，少写空泛鸡汤。若阶段摘要来自跨日会话，前序上下文只用于理解，绝不能把其中昨天已完成的事项计入本次日期成果；只总结标记为本次活动日期的正文。不要记录密钥、token、一次性路径、工具原始输出或命令输出。",
    },
    {
      role: "user",
      content: `日期：${formatConversationActivityRange(input)}\n来源：${formatConversationSource(input)}\n会话数：${input.sessions.length}\n内容已脱敏：${input.redacted ? "是" : "否"}\n内容已截断：${input.truncated ? "是" : "否"}\n\n阶段摘要：\n${chunkSummaries
        .map((summary, index) => `【片段 ${index + 1}】\n${summary}`)
        .join("\n\n---\n\n")}\n\n请只输出 Markdown 正文。`,
    },
  ];
}

function buildRollingWorkReviewMessages(input: RollingWorkReviewUpdateInput, deltaContext: string[]): ChatMessage[] {
  const current = input.currentContent.trim() || "今天还没有形成工作内容。";
  return [
    {
      role: "system",
      content:
        "你正在维护一份当天工作内容记录。请基于“当前版本”和“新增对话片段”更新同一份 Markdown 文档，不要另起一份总结。保留已准确内容，合并重复事项，删除明显过时的进行中状态，不编造新增对话里没有的信息。片段中若出现“前序上下文，仅用于理解”标记，其中内容只能用于理解当前工作的背景，绝不能计入当天的已完成、决策或待办。固定使用这些二级标题：已完成、正在进行、关键决策、问题与风险、待办、可沉淀为长期记忆的候选。不要记录密钥、token、临时路径或原始命令输出。",
    },
    {
      role: "user",
      content: [
        `日期：${input.date}`,
        `来源：${formatSourceKindList(input.sourceKinds)}`,
        `累计处理会话：${input.processedSessionCount}`,
        `累计处理字符：${input.processedChars}`,
        `新增内容已脱敏：${input.redacted ? "是" : "否"}`,
        `新增内容已截断：${input.truncated ? "是" : "否"}`,
        "",
        "当前版本：",
        current,
        "",
        "新增对话片段或片段摘要：",
        deltaContext.map((summary, index) => `【新增 ${index + 1}】\n${summary}`).join("\n\n---\n\n"),
        "",
        "请只输出更新后的完整 Markdown 正文。",
      ].join("\n"),
    },
  ];
}

function formatRollingWorkDelta(delta: ConversationSessionDelta) {
  const parts = [
    `来源：${delta.sourceLabel}`,
    `日期：${delta.date}`,
    `会话：${delta.sessionId}`,
    `新增消息：${delta.messageCount}`,
    `已脱敏：${delta.redacted ? "是" : "否"}`,
    `已截断：${delta.truncated ? "是" : "否"}`,
  ];
  if (delta.contextTranscript.trim()) {
    parts.push("", "前序上下文，仅用于理解，不计入今日工作：", delta.contextTranscript.trim());
  }
  parts.push("", "本次活动日期的新增正文：", delta.transcript);
  return parts.join("\n");
}

function buildConversationReviewJsonMessages(input: ConversationReviewInput, chunkSummaries: string[]): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "你是个人工作/聊天回顾助手。请输出 JSON 对象，字段为 title 和 content。content 使用中文，语气安静克制，结构固定为：今日做了什么、关键决定、还悬着的事、值得沉淀的线索。跨日会话的前序上下文只能用于理解，不得算作本次日期成果。不要写空泛鸡汤，不要记录密钥、token、一次性路径或命令输出。",
    },
    {
      role: "user",
      content: `日期：${formatConversationActivityRange(input)}\n来源：${formatConversationSource(input)}\n会话数：${input.sessions.length}\n内容已脱敏：${input.redacted ? "是" : "否"}\n内容已截断：${input.truncated ? "是" : "否"}\n\n阶段摘要：\n${chunkSummaries
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
        "你是长期记忆文档编辑。请像 GPT 记忆那样维护一份第三人称、分节、可长期复用的用户画像文档。不要生成孤立卡片。只保留长期稳定信息：偏好、项目方向、工具习惯、设计原则、长期约束、反复出现的工作方式。明确排除临时报错、一次性命令、路径碎片、密钥、token、无上下文结论、当天情绪噪声。输出 JSON 对象，字段为 action、title、rationale、proposedContent。发现值得长期保留的新信息时 action 为 create，proposedContent 必须是合并后的完整长期记忆文档；没有新增长期信息时 action 为 none，并保持 proposedContent 与当前长期记忆一致。正文不写来源日期。",
    },
    {
      role: "user",
      content: `当前长期记忆文档：\n${currentMemory || "（暂时为空）"}\n\n本次回顾来源：${review.sourceLabel}\n日期：${review.date}\n标题：${review.title}\n正文：\n${review.content}\n\n请给出简洁且准确的修改。如果没有值得留下的长期记忆，保持原文档基本不变，并在 rationale 中说明原因。只输出 JSON。`,
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

function normalizeReviewOutput(value: string, fallbackTitle: string): JournalSummaryResult {
  const content = stripCodeFence(value).trim();
  const title = extractMarkdownTitle(content) || fallbackTitle;
  const lines = content.split(/\r?\n/);
  const firstContentLine = lines.findIndex((line) => line.trim().length > 0);
  if (firstContentLine < 0 || !lines[firstContentLine].trim().startsWith("#")) {
    return { title, content };
  }

  const heading = cleanTitle(lines[firstContentLine].replace(/^#+\s*/, ""));
  if (!heading || heading !== cleanTitle(title)) return { title, content };

  const withoutRepeatedTitle = lines.slice(firstContentLine + 1).join("\n").trim();
  return { title, content: withoutRepeatedTitle || content };
}

function formatConversationSource(input: Pick<ConversationReviewInput, "reviewKind" | "sourceKinds">) {
  if (input.reviewKind === "combined") return "综合";
  if (input.sourceKinds.includes("claude") && input.sourceKinds.includes("codex")) return "AI 对话";
  if (input.sourceKinds.includes("claude")) return "Claude Code";
  return "Codex";
}

function formatConversationActivityRange(input: Pick<ConversationReviewInput, "date" | "activityDateFrom" | "activityDateTo">) {
  if (input.activityDateFrom && input.activityDateTo) {
    return input.activityDateFrom === input.activityDateTo
      ? input.activityDateFrom
      : `${input.activityDateFrom} 至 ${input.activityDateTo}`;
  }
  return input.activityDateFrom || input.activityDateTo || input.date;
}

function formatSourceKindList(sourceKinds: ConversationSourceKind[]) {
  if (sourceKinds.includes("claude") && sourceKinds.includes("codex")) return "Codex、Claude Code";
  if (sourceKinds.includes("claude")) return "Claude Code";
  return "Codex";
}

function chunkPlainText(value: string, chunkSize: number) {
  const chars = Array.from(value);
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += chunkSize) {
    chunks.push(chars.slice(index, index + chunkSize).join(""));
  }
  return chunks.length > 0 ? chunks : [""];
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
