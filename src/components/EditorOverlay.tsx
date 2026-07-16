import { Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { EditForm } from "./EditForm";
import { ConfirmDialog } from "./ConfirmDialog";
import { getSafeErrorMessage } from "../lib/redaction";
import type { FolderNode, Item } from "../types";

type EditorOverlayProps = {
  open: boolean;
  draft: Item | null;
  folders: FolderNode[];
  tagText: string;
  dirty: boolean;
  onDraftChange: (item: Item) => void;
  onTagTextChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => Promise<void> | void;
};

export function EditorOverlay({
  open,
  draft,
  folders,
  tagText,
  dirty,
  onDraftChange,
  onTagTextChange,
  onCancel,
  onSave,
}: EditorOverlayProps) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    if (open) {
      setMessage("");
      setDiscardConfirmOpen(false);
    }
  }, [open]);

  const requestCancel = () => {
    if (savingRef.current) {
      setMessage("正在保存，完成后再关闭。");
      return;
    }
    if (dirty) {
      setDiscardConfirmOpen(true);
      return;
    }
    onCancel();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dirty, open, onCancel, saving]);

  if (!open || !draft) return null;

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      await onSave();
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "保存失败，请稍后再试。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section aria-label="编辑资料" aria-modal="true" className="modal-surface flex max-h-[92vh] w-full max-w-6xl flex-col" role="dialog">
        <header className="flex items-center justify-between gap-3 border-b border-line bg-panel/70 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-copper">编辑条目</p>
            <input
              value={draft.title}
              onChange={(event) => onDraftChange({ ...draft, title: event.target.value })}
              className="field-control field-prominent w-full text-xl font-semibold"
              placeholder="标题"
              autoFocus
            />
          </div>
          <div className="flex shrink-0 items-center gap-2 self-end">
            <button
              className="soft-button icon-action-prominent"
              disabled={saving}
              onClick={requestCancel}
              title="取消"
              aria-label="关闭编辑资料"
            >
              <X size={17} />
            </button>
            <button
              className="primary-button action-prominent"
              disabled={saving}
              onClick={() => void save()}
            >
              <Save size={16} />
              保存
            </button>
          </div>
        </header>
        {message && <div className="border-b border-line bg-panel/70 px-5 py-2 text-sm text-red-400">{message}</div>}
        <div className="min-h-0 flex-1 overflow-y-auto bg-panel/40 p-5 scrollbar-thin">
          <EditForm
            draft={draft}
            folders={folders}
            tagText={tagText}
            onDraftChange={onDraftChange}
            onTagTextChange={onTagTextChange}
          />
        </div>
      </section>
      <ConfirmDialog
        open={discardConfirmOpen}
        title="放弃未保存修改？"
        message="关闭后，这次对资料的修改不会保存。"
        confirmLabel="放弃修改"
        danger
        onCancel={() => setDiscardConfirmOpen(false)}
        onConfirm={() => {
          setDiscardConfirmOpen(false);
          onCancel();
        }}
      />
    </div>
  );
}
