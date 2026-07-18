import { GitCompareArrows, Save, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { getSafeErrorMessage } from "../lib/redaction";
import type { DailyConversationReview, FolderNode, Item } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { MarkdownContent } from "./MarkdownContent";
import { MarkdownEditor } from "./MarkdownEditor";

export type ReviewLibraryUpdateMode = "update-current" | "create-version";

export type ReviewLibraryUpdateDraft = {
  title: string;
  content: string;
};

export type ReviewLibraryUpdateContext = {
  item: Item;
  source: DailyConversationReview;
};

type ReviewLibraryUpdateDialogProps = {
  open: boolean;
  item: Item | null;
  source: DailyConversationReview | null;
  items: Item[];
  folders: FolderNode[];
  onClose: () => void;
  onSubmit: (
    mode: ReviewLibraryUpdateMode,
    draft: ReviewLibraryUpdateDraft,
    context: ReviewLibraryUpdateContext,
  ) => Promise<void> | void;
};

export function ReviewLibraryUpdateDialog({
  open,
  item,
  source,
  items,
  folders,
  onClose,
  onSubmit,
}: ReviewLibraryUpdateDialogProps) {
  const [context, setContext] = useState<ReviewLibraryUpdateContext | null>(null);
  const [draft, setDraft] = useState<ReviewLibraryUpdateDraft>({ title: "", content: "" });
  const [savingMode, setSavingMode] = useState<ReviewLibraryUpdateMode | null>(null);
  const [message, setMessage] = useState("");
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const wasOpenRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const validationId = useId();
  const statusId = useId();
  const updatePolicyId = useId();
  const createPolicyId = useId();

  const initialDraft = context
    ? { title: context.source.title, content: context.source.content }
    : { title: "", content: "" };
  const dirty = Boolean(
    context && (draft.title !== initialDraft.title || draft.content !== initialDraft.content),
  );
  const valid = Boolean(draft.title.trim() && draft.content.trim());
  const titleMissing = !draft.title.trim();
  const contentMissing = !draft.content.trim();
  const busy = savingMode !== null;

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const nextContext = item && source ? { item, source } : null;
      setContext(nextContext);
      setDraft(nextContext ? { title: nextContext.source.title, content: nextContext.source.content } : { title: "", content: "" });
      setSavingMode(null);
      setMessage("");
      setDiscardConfirmOpen(false);
      window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    }
    if (!open && wasOpenRef.current) {
      setContext(null);
      setSavingMode(null);
      setMessage("");
      setDiscardConfirmOpen(false);
    }
    wasOpenRef.current = open;
  }, [item, open, source]);

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    return () => {
      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (previous?.isConnected) window.setTimeout(() => previous.focus(), 0);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && document.querySelector(".markdown-reference-picker")) return;
      if (event.key === "Escape" && !busy && !discardConfirmOpen) {
        event.preventDefault();
        requestClose();
        return;
      }
      if (event.key !== "Tab" || discardConfirmOpen) return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (!activeElement || !dialogRef.current?.contains(activeElement) || !focusable.includes(activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [busy, dirty, discardConfirmOpen, open]);

  if (!open) return null;

  function requestClose() {
    if (busy) {
      setMessage("正在保存，完成后再关闭。");
      return;
    }
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  }

  async function submit(mode: ReviewLibraryUpdateMode) {
    if (!context || !valid || busy) return;
    setSavingMode(mode);
    setMessage("");
    try {
      await onSubmit(
        mode,
        { title: draft.title.trim(), content: draft.content.trim() },
        context,
      );
      onClose();
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "更新资料失败，请重新核对来源后再试。"));
    } finally {
      setSavingMode(null);
    }
  }

  return (
    <div className="modal-backdrop">
      <section
        aria-busy={busy}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-surface flex max-h-[92vh] w-full max-w-6xl flex-col"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-panel/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-copper">
              <GitCompareArrows size={14} />
              Review Sync
            </div>
            <h2 className="mt-1 text-lg font-semibold text-ink" id={titleId}>对比并更新资料</h2>
            <p className="mt-1 text-sm leading-6 text-ink/52" id={descriptionId}>
              左右内容仅用于核对；最终写入内容可以在下方继续编辑。
            </p>
          </div>
          <button
            aria-label="关闭对比更新"
            className="soft-button icon-action-standard"
            disabled={busy}
            onClick={requestClose}
            ref={closeButtonRef}
            title="关闭"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
          {!context ? (
            <p className="rounded-[8px] border border-line bg-panel/70 p-4 text-sm leading-6 text-ink/52">
              找不到当前资料或最新正式回顾，请关闭后重新打开。
            </p>
          ) : (
            <div className="space-y-4">
              <div className="grid min-w-0 gap-3 lg:grid-cols-2">
                <ComparisonPane label="当前资料" title={context.item.title} content={context.item.content} />
                <ComparisonPane label="最新正式回顾" title={context.source.title} content={context.source.content} accent />
              </div>

              <section className="rounded-[8px] border border-line bg-panel/55 p-4">
                <div className="mb-3">
                  <h3 className="text-sm font-semibold text-ink">最终写入内容</h3>
                  <p className="mt-1 text-xs leading-5 text-ink/45">
                    默认采用最新正式回顾。两种保存方式对现有属性的处理不同，请在提交前确认。
                  </p>
                </div>
                <div className="mb-4 grid gap-2 text-xs leading-5 text-ink/52 lg:grid-cols-2">
                  <p className="rounded-[8px] border border-line bg-paper/75 px-3 py-2" id={updatePolicyId}>
                    <span className="font-medium text-ink/70">更新当前资料：</span>
                    仅替换标题和正文，保留目录、标签、整理状态、阅读状态、收藏、待办、AI 结果、最近打开时间、AI 运行记录和知识链接。
                  </p>
                  <p className="rounded-[8px] border border-line bg-paper/75 px-3 py-2" id={createPolicyId}>
                    <span className="font-medium text-ink/70">另存新版本：</span>
                    继承目录、标签、整理状态和阅读状态；重置收藏、待办、AI 结果、最近打开时间、AI 运行记录和知识链接。
                  </p>
                </div>
                <label className="block text-xs font-medium text-ink/58">
                  标题
                  <input
                    aria-describedby={titleMissing ? validationId : undefined}
                    aria-invalid={titleMissing}
                    className="field-control field-prominent mt-1 w-full"
                    disabled={busy}
                    onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                    value={draft.title}
                  />
                </label>
                <div className="mt-3">
                  <MarkdownEditor
                    ariaDescribedBy={contentMissing ? validationId : undefined}
                    ariaInvalid={contentMissing}
                    disabled={busy}
                    currentItem={context.item}
                    folders={folders}
                    items={items}
                    label="正文"
                    minHeightClass="min-h-[300px]"
                    onChange={(content) => setDraft((current) => ({ ...current, content }))}
                    value={draft.content}
                  />
                </div>
                {!valid && <p className="mt-2 text-xs font-medium text-copper" id={validationId}>标题和正文不能为空。</p>}
                {message && (
                  <p className="mt-3 rounded-[8px] border border-line bg-paper px-3 py-2 text-anywhere text-sm leading-6 text-red-400" role="alert">
                    {message}
                  </p>
                )}
              </section>
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col items-stretch gap-3 border-t border-line bg-panel/70 px-5 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs leading-5 text-ink/42">提交前会再次校验资料和来源，避免覆盖打开弹窗后的变化。</p>
            <p className="sr-only" id={statusId} aria-live="polite" role="status">
              {savingMode === "update-current" ? "正在更新当前资料" : savingMode === "create-version" ? "正在创建新版本" : message}
            </p>
          </div>
          <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-3 lg:w-auto">
            <button className="soft-button action-prominent w-full justify-center" disabled={busy} onClick={requestClose}>
              取消
            </button>
            <button
              aria-describedby={createPolicyId}
              className="secondary-action action-prominent w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || !context || !valid}
              onClick={() => void submit("create-version")}
            >
              {savingMode === "create-version" ? "正在创建" : "另存新版本"}
            </button>
            <button
              aria-describedby={updatePolicyId}
              className="primary-button action-prominent w-full justify-center disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busy || !context || !valid}
              onClick={() => void submit("update-current")}
            >
              <Save size={16} />
              {savingMode === "update-current" ? "正在更新" : "更新当前资料"}
            </button>
          </div>
        </footer>
      </section>

      <ConfirmDialog
        open={discardConfirmOpen}
        title="放弃本次更新编辑？"
        message="关闭后，对最终标题和正文所做的修改将被舍弃。"
        confirmLabel="舍弃修改"
        danger
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          onClose();
        }}
      />
    </div>
  );
}

function ComparisonPane({
  label,
  title,
  content,
  accent = false,
}: {
  label: string;
  title: string;
  content: string;
  accent?: boolean;
}) {
  return (
    <section className={`min-w-0 rounded-[8px] border p-4 ${accent ? "border-copper/30 bg-copper/5" : "border-line bg-panel/70"}`}>
      <div className={`text-xs font-semibold uppercase tracking-[0.14em] ${accent ? "text-copper" : "text-ink/45"}`}>{label}</div>
      <h3 className="mt-2 text-anywhere text-base font-semibold leading-6 text-ink">{title || "无标题"}</h3>
      <div className="mt-3 max-h-[360px] overflow-y-auto border-t border-line/60 pt-3 scrollbar-thin">
        <MarkdownContent compact content={content} emptyText="没有正文内容。" />
      </div>
    </section>
  );
}
