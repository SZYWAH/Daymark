import { useMemo, useRef, useState } from "react";

import { readSelectedConversationSessions } from "../lib/desktop";
import { getSafeErrorMessage } from "../lib/redaction";
import type { CodexSessionIndex, ConversationSourceKind } from "../types";
import { FocusOverlay } from "./FocusOverlay";
import { BoundedPreview, ResultRow, ScrollableResultPanel } from "./ResultPanels";
import { SelectMenu } from "./SelectMenu";

function createClientJobId() {
  return `daymark-job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function ConversationSessionPreviewOverlay({
  sessions,
  selectedIds,
  onToggleSession,
  onClose,
}: {
  sessions: CodexSessionIndex[];
  selectedIds: Set<string>;
  onToggleSession: (id: string) => void;
  onClose: () => void;
}) {
  const [sourceFilter, setSourceFilter] = useState<"all" | ConversationSourceKind>("all");
  const [dateQuery, setDateQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [previewingId, setPreviewingId] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [previewMeta, setPreviewMeta] = useState("");
  const [message, setMessage] = useState("");
  const previewRequestSeqRef = useRef(0);

  const filtered = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return sessions.filter((session) => {
      if (sourceFilter !== "all" && session.sourceKind !== sourceFilter) return false;
      if (dateQuery && !session.date.includes(dateQuery)) return false;
      if (!normalized) return true;
      return [session.title, session.preview, session.path, session.cwd, session.sourceLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized);
    });
  }, [dateQuery, keyword, sessions, sourceFilter]);

  const openPreview = async (session: CodexSessionIndex) => {
    const requestSeq = previewRequestSeqRef.current + 1;
    previewRequestSeqRef.current = requestSeq;
    setPreviewingId(session.id);
    setMessage("");
    setPreviewText("");
    setPreviewMeta("");
    try {
      const input = await readSelectedConversationSessions([session.id], createClientJobId());
      if (previewRequestSeqRef.current !== requestSeq) return;
      setPreviewText(input.transcriptChunks.join("\n\n"));
      setPreviewMeta(
        `${session.sourceLabel} · ${session.date} · ${input.totalChars.toLocaleString("zh-CN")} 字符${
          input.redacted ? " · 已脱敏" : ""
        }${input.truncated ? " · 已截断" : ""}`,
      );
    } catch (error) {
      if (previewRequestSeqRef.current !== requestSeq) return;
      setMessage(getSafeErrorMessage(error, "读取会话预览失败。"));
    } finally {
      if (previewRequestSeqRef.current === requestSeq) setPreviewingId("");
    }
  };

  const copyPreviewText = async () => {
    if (!previewText) return;
    setMessage("");
    try {
      await navigator.clipboard?.writeText(previewText);
      setMessage("已复制会话正文预览。");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "复制失败，请稍后再试。"));
    }
  };

  return (
    <FocusOverlay title="会话列表预览" onClose={onClose}>
      <div className="mb-3 rounded-[8px] border border-line bg-panel/70 p-3 text-xs leading-5 text-ink/52">
        这里只做本机只读预览：点击单个会话后才读取正文，先脱敏再显示；不会保存、不会上传，也不会触发 AI。
      </div>

      <div className="mb-3 grid gap-2 lg:grid-cols-[180px_160px_minmax(0,1fr)]">
        <SelectMenu
          value={sourceFilter}
          options={[
            { value: "all", label: "全部来源" },
            { value: "codex", label: "Codex" },
            { value: "claude", label: "Claude Code" },
          ]}
          onChange={(value) => setSourceFilter(value as "all" | ConversationSourceKind)}
          triggerClassName="field-standard px-2 text-xs shadow-none"
        />
        <input
          value={dateQuery}
          onChange={(event) => setDateQuery(event.target.value)}
          className="field-control field-standard px-2 text-xs"
          placeholder="日期，如 2026-07"
        />
        <input
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          className="field-control field-standard px-2 text-xs"
          placeholder="搜索标题、路径、预览"
        />
      </div>

      <div className="grid h-[min(70vh,720px)] min-h-0 overflow-hidden gap-4 lg:grid-cols-[minmax(300px,0.82fr)_minmax(0,1.18fr)]">
        <ScrollableResultPanel
          fill
          title="会话列表"
          count={`${filtered.length} 条`}
          bodyClassName="space-y-2"
        >
          {filtered.map((session) => {
            const selected = selectedIds.has(session.id);
            return (
              <ResultRow key={`${session.id}-${session.path}`} selected={selected}>
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-anywhere text-sm font-semibold text-ink">{session.title}</h4>
                      <span className="quiet-chip py-0.5 text-[11px] text-ink/50">{session.sourceLabel}</span>
                    </div>
                    <p className="ui-text-meta mt-1 truncate text-anywhere text-xs">{session.path}</p>
                  </div>
                  <span className="ui-text-meta shrink-0 text-[11px]">{session.date}</span>
                </div>
                <BoundedPreview maxLinesClass="line-clamp-2" className="text-xs leading-5 text-ink/54">
                  {session.preview}
                </BoundedPreview>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button className="soft-button action-micro" onClick={() => onToggleSession(session.id)}>
                    {selected ? "取消勾选" : "勾选"}
                  </button>
                  <button className="soft-button action-micro" disabled={previewingId === session.id} onClick={() => void openPreview(session)}>
                    {previewingId === session.id ? "读取中" : "只读预览"}
                  </button>
                </div>
              </ResultRow>
            );
          })}
          {filtered.length === 0 && (
            <div className="ui-text-meta p-5 text-center text-sm">没有符合筛选条件的会话。</div>
          )}
        </ScrollableResultPanel>

        <ScrollableResultPanel
          fill
          title="会话正文预览"
          status={previewMeta || "选择左侧会话后显示。"}
          actions={
            previewText ? (
              <button className="soft-button action-compact" onClick={() => void copyPreviewText()}>
                复制
              </button>
            ) : undefined
          }
          bodyClassName="flex flex-col gap-3"
        >
          {message && <div className="shrink-0 rounded-[8px] border border-line bg-panel p-3 text-xs leading-5 text-anywhere text-ink/70">{message}</div>}
          <pre className="conversation-code-surface min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap rounded-[8px] bg-surface p-4 text-anywhere text-xs leading-6 text-ink/66 scrollbar-thin">
            {previewText || "还没有打开任何会话正文。"}
          </pre>
        </ScrollableResultPanel>
      </div>
    </FocusOverlay>
  );
}
