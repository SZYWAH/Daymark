import { Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FolderPicker } from "./FolderPicker";
import { getSafeErrorMessage } from "../lib/redaction";
import type { FolderNode } from "../types";

export type ExtractDraft = {
  title: string;
  content: string;
  tags: string[];
  aiSummary: string;
  folderId?: string;
};

type ExtractDialogProps = {
  open: boolean;
  loading: boolean;
  draft: ExtractDraft | null;
  folders: FolderNode[];
  message: string;
  onDraftChange: (draft: ExtractDraft) => void;
  onClose: () => void;
  onCancelGeneration?: () => void;
  onSave: () => Promise<void> | void;
};

export function ExtractDialog({
  open,
  loading,
  draft,
  folders,
  message,
  onDraftChange,
  onClose,
  onCancelGeneration,
  onSave,
}: ExtractDialogProps) {
  const [saving, setSaving] = useState(false);
  const [localMessage, setLocalMessage] = useState("");
  const savingRef = useRef(false);
  const pendingCloseRef = useRef(false);
  const dirty = Boolean(draft && !loading);

  useEffect(() => {
    if (open) {
      setLocalMessage("");
      pendingCloseRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    pendingCloseRef.current = false;
  }, [draft?.aiSummary, draft?.content, draft?.folderId, draft?.tags, draft?.title]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onClose, open, saving]);

  if (!open) return null;

  const requestClose = () => {
    if (savingRef.current) {
      setLocalMessage("正在保存，完成后再关闭。");
      return;
    }
    if (loading) {
      onCancelGeneration?.();
      return;
    }
    if (dirty && !pendingCloseRef.current) {
      pendingCloseRef.current = true;
      setLocalMessage("这份知识卡片草稿还没有保存。再次点击关闭才会放弃它。");
      return;
    }
    onClose();
  };

  const save = async () => {
    if (savingRef.current || loading || !draft) return;
    savingRef.current = true;
    setSaving(true);
    setLocalMessage("");
    try {
      await onSave();
    } catch (error) {
      setLocalMessage(getSafeErrorMessage(error, "保存失败，请稍后再试。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section aria-label="沉淀为知识卡片" aria-modal="true" className="modal-surface flex max-h-[92vh] w-full max-w-3xl flex-col" role="dialog">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line bg-panel/70 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">沉淀为知识卡片</h2>
            <p className="mt-1 text-sm text-ink/52">把这一段日常，整理成可以长期留下的知识。</p>
          </div>
          <button
            className="soft-button icon-action-standard"
            disabled={saving}
            onClick={requestClose}
            aria-label="关闭知识卡片草稿"
            title="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
          {loading || !draft ? (
            <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 border-t border-line/60 bg-transparent text-sm text-ink/45">
              <span>正在整理知识卡片草稿...</span>
              {localMessage && <span className="text-xs text-ink/50">{localMessage}</span>}
              {loading && (
                <button className="soft-button action-standard text-xs" onClick={onCancelGeneration}>
                  取消生成
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
            {(message || localMessage) && <div className="rounded-[8px] border border-line bg-panel p-3 text-anywhere text-sm text-ink/70">{localMessage || message}</div>}
            <label className="block text-xs font-medium text-ink/58">
              标题
              <input
                value={draft.title}
                onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
                className="field-control field-prominent mt-1 w-full"
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
                rows={7}
                className="field-control mt-1 max-h-[260px] w-full resize-none overflow-y-auto px-3 py-2 text-sm leading-6 scrollbar-thin"
              />
            </label>
            <label className="block text-xs font-medium text-ink/58">
              AI 摘要
              <textarea
                value={draft.aiSummary}
                onChange={(event) => onDraftChange({ ...draft, aiSummary: event.target.value })}
                rows={3}
                className="field-control mt-1 max-h-[160px] w-full resize-none overflow-y-auto px-3 py-2 text-sm leading-6 scrollbar-thin"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                className="soft-button action-prominent"
                disabled={saving}
                onClick={requestClose}
              >
                取消
              </button>
              <button
                className="primary-button action-prominent"
                disabled={saving || loading}
                onClick={() => void save()}
              >
                <Save size={16} />
                存入资料库
              </button>
            </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
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
