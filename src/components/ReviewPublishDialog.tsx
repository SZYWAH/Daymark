import { Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getSafeErrorMessage } from "../lib/redaction";
import type { ReviewLibraryDraft } from "../lib/reviewLibraryPublication";
import type { DailyConversationReview, FolderNode } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { FolderPicker } from "./FolderPicker";

type ReviewPublishDialogProps = {
  open: boolean;
  review: DailyConversationReview | null;
  draft: ReviewLibraryDraft | null;
  initialDraft: ReviewLibraryDraft | null;
  folders: FolderNode[];
  onDraftChange: (draft: ReviewLibraryDraft) => void;
  onClose: () => void;
  onSave: () => Promise<void> | void;
};

export function ReviewPublishDialog({
  open,
  review,
  draft,
  initialDraft,
  folders,
  onDraftChange,
  onClose,
  onSave,
}: ReviewPublishDialogProps) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const discardLayerRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const dirty = Boolean(draft && initialDraft && serializeDraft(draft) !== serializeDraft(initialDraft));
  const valid = Boolean(draft?.title.trim() && draft?.content.trim());

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setDiscardConfirmOpen(false);
  }, [open, review?.id]);

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => titleInputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      const restoreTarget = restoreFocusRef.current;
      restoreFocusRef.current = null;
      window.setTimeout(() => {
        if (restoreTarget?.isConnected) restoreTarget.focus();
      }, 0);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !discardConfirmOpen) return undefined;
    const focusTimer = window.setTimeout(() => {
      discardLayerRef.current
        ?.querySelector<HTMLElement>(".secondary-action:not([disabled]), button:not([disabled])")
        ?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [discardConfirmOpen, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest(".select-pop")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (discardConfirmOpen) {
          setDiscardConfirmOpen(false);
          window.setTimeout(() => cancelButtonRef.current?.focus(), 0);
        } else {
          requestClose();
        }
        return;
      }

      if (event.key !== "Tab") return;
      const focusRoot = discardConfirmOpen
        ? discardLayerRef.current?.querySelector<HTMLElement>("[role='alertdialog'], [role='dialog']")
        : dialogRef.current;
      if (!focusRoot) return;
      const focusable = Array.from(
        focusRoot.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !focusRoot.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !focusRoot.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dirty, discardConfirmOpen, open, saving]);

  if (!open) return null;

  const requestClose = () => {
    if (savingRef.current) {
      setMessage("正在保存，完成后再关闭。");
      return;
    }
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onClose();
  };

  const save = async () => {
    if (savingRef.current || !review || !draft || !valid) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      await onSave();
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "保存到资料库失败，请稍后重试。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section
        aria-label="保存回顾到资料库"
        aria-modal="true"
        className="modal-surface flex max-h-[92vh] w-full max-w-3xl flex-col"
        ref={dialogRef}
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-panel/70 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-ink">保存回顾到资料库</h2>
            <p className="mt-1 text-sm text-ink/52">保存的是当前回顾快照，之后不会自动覆盖资料中的修改。</p>
          </div>
          <button
            className="soft-button icon-action-standard"
            disabled={saving}
            onClick={requestClose}
            aria-label="关闭回顾资料草稿"
            title="关闭"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
          {!review || !draft ? (
            <p className="text-sm text-ink/45">找不到可保存的正式回顾，请关闭后重新打开。</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-[8px] border border-line bg-panel/70 px-3 py-2 text-xs leading-5 text-ink/52">
                <span>{review.date}</span>
                <span>{` · ${review.sourceLabel}`}</span>
                <span>{` · ${getReviewTypeLabel(review)}`}</span>
                <span>{` · ${review.sessionCount} 个会话`}</span>
              </div>
              {message && (
                <div className="rounded-[8px] border border-line bg-panel p-3 text-anywhere text-sm text-ink/70" aria-live="polite">
                  {message}
                </div>
              )}
              <label className="block text-xs font-medium text-ink/58">
                标题
                <input
                  value={draft.title}
                  onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
                  className="field-control field-prominent mt-1 w-full"
                  ref={titleInputRef}
                />
              </label>
              <label className="block text-xs font-medium text-ink/58">
                放到目录
                <div className="mt-1">
                  <FolderPicker
                    folders={folders}
                    value={draft.folderId}
                    onChange={(folderId) => onDraftChange({ ...draft, folderId })}
                  />
                </div>
              </label>
              <label className="block text-xs font-medium text-ink/58">
                标签
                <input
                  value={draft.tags.join("，")}
                  onChange={(event) => onDraftChange({ ...draft, tags: parseTags(event.target.value) })}
                  className="field-control field-prominent mt-1 w-full"
                />
              </label>
              <label className="block text-xs font-medium text-ink/58">
                正文
                <textarea
                  value={draft.content}
                  onChange={(event) => onDraftChange({ ...draft, content: event.target.value })}
                  rows={12}
                  className="field-control mt-1 max-h-[420px] w-full resize-none overflow-y-auto px-3 py-2 text-sm leading-6 scrollbar-thin"
                />
              </label>
              {!valid && <p className="text-xs text-copper">标题和正文不能为空。</p>}
              <div className="flex justify-end gap-2">
                <button
                  className="soft-button action-prominent"
                  disabled={saving}
                  onClick={requestClose}
                  ref={cancelButtonRef}
                >
                  取消
                </button>
                <button
                  className="primary-button action-prominent disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={saving || !valid}
                  onClick={() => void save()}
                >
                  <Save size={16} />
                  {saving ? "保存中" : "存入资料库"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
      <div ref={discardLayerRef}>
        <ConfirmDialog
          open={discardConfirmOpen}
          title="放弃资料草稿？"
          message="关闭后，本次对标题、正文、标签或目录的修改将被舍弃。"
          confirmLabel="舍弃草稿"
          danger
          onCancel={() => {
            setDiscardConfirmOpen(false);
            window.setTimeout(() => cancelButtonRef.current?.focus(), 0);
          }}
          onConfirm={() => {
            setDiscardConfirmOpen(false);
            onClose();
          }}
        />
      </div>
    </div>
  );
}

function getReviewTypeLabel(review: DailyConversationReview) {
  if (review.reviewKind === "combined") return "综合回顾";
  if (review.reviewKind === "auto-work") return "自动工作回顾";
  return "单来源回顾";
}

function parseTags(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,，、\n]/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  );
}

function serializeDraft(draft: ReviewLibraryDraft) {
  return JSON.stringify({
    ...draft,
    folderId: draft.folderId || "",
  });
}
