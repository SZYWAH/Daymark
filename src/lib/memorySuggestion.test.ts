import { describe, expect, it } from "vitest";
import {
  createMemoryContentVersion,
  createMemorySuggestionCheckpoint,
  createReviewContentVersion,
  isMemorySuggestionCheckpointCurrent,
  isMemorySuggestionSourceOutdated,
  shouldCreateMemorySuggestion,
  updateMemorySuggestionCheckpoint,
} from "./memorySuggestion";

describe("memory suggestion helpers", () => {
  it("creates stable content versions and detects source edits", () => {
    const version = createReviewContentVersion("标题", "正文");
    expect(createReviewContentVersion("标题", "正文")).toBe(version);
    expect(isMemorySuggestionSourceOutdated(version, "标题", "正文")).toBe(false);
    expect(isMemorySuggestionSourceOutdated(version, "标题", "修改后的正文")).toBe(true);
  });

  it("does not create no-op or explicitly empty suggestions", () => {
    expect(shouldCreateMemorySuggestion("none", "新的内容", "原内容")).toBe(false);
    expect(shouldCreateMemorySuggestion("create", "原内容\r\n", "原内容\n")).toBe(false);
    expect(shouldCreateMemorySuggestion("create", "新增长期信息", "原内容")).toBe(true);
  });

  it("keeps checkpoints content-free and invalidates them when source or memory changes", () => {
    const input = {
      sourceReviewId: "review-1",
      sourceContentVersion: createReviewContentVersion("标题", "回顾正文"),
      memoryContentVersion: createMemoryContentVersion("长期记忆"),
    };
    const checkpoint = createMemorySuggestionCheckpoint(input);

    expect(isMemorySuggestionCheckpointCurrent(checkpoint, input)).toBe(true);
    expect(isMemorySuggestionCheckpointCurrent(checkpoint, {
      ...input,
      sourceContentVersion: createReviewContentVersion("标题", "修改后的回顾正文"),
    })).toBe(false);
    expect(isMemorySuggestionCheckpointCurrent(checkpoint, {
      ...input,
      memoryContentVersion: createMemoryContentVersion("更新后的长期记忆"),
    })).toBe(false);
    expect(JSON.stringify(checkpoint)).not.toContain("回顾正文");
    expect(JSON.stringify(checkpoint)).not.toContain("长期记忆");
  });

  it("preserves source identity while recording a failed attempt", () => {
    const checkpoint = createMemorySuggestionCheckpoint({
      sourceReviewDraftId: "review-draft-1",
      sourceContentVersion: "source-v1",
      memoryContentVersion: "memory-v1",
    });
    const failed = updateMemorySuggestionCheckpoint(checkpoint, {
      status: "failed",
      executionMode: "non-stream",
      attemptCount: 3,
      retryCount: 2,
      lastError: "请求超时。",
    });

    expect(failed).toMatchObject({
      sourceReviewDraftId: "review-draft-1",
      status: "failed",
      executionMode: "non-stream",
      attemptCount: 3,
      retryCount: 2,
      lastError: "请求超时。",
    });
  });
});
