import { AlertTriangle, Check, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  showCloseButton?: boolean;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
  onSecondary?: () => Promise<void> | void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  secondaryLabel,
  showCloseButton = true,
  danger = false,
  onCancel,
  onConfirm,
  onSecondary,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setError("");
      return undefined;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);

  if (!open) return null;

  const runAction = async (action: () => Promise<void> | void) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : "操作失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby={messageId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-surface max-h-[min(92vh,540px)] w-full max-w-md overflow-y-auto p-5 scrollbar-thin"
        role={danger ? "alertdialog" : "dialog"}
      >
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border ${
              danger ? "border-red-400/30 bg-red-500/10 text-red-300" : "border-line bg-panel text-ink/62"
            }`}
          >
            <AlertTriangle size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink" id={titleId}>
              {title}
            </h2>
            <div className="mt-2 text-anywhere text-sm leading-6 text-ink/58" id={messageId}>
              {message}
            </div>
          </div>
          {showCloseButton && (
            <button
              className="soft-button icon-action-compact"
              disabled={busy}
              onClick={onCancel}
              title="关闭"
              aria-label="关闭"
            >
              <X size={15} />
            </button>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-action action-standard" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          {secondaryLabel && onSecondary && (
            <button className="secondary-action action-standard" disabled={busy} onClick={() => void runAction(onSecondary)}>
              {secondaryLabel}
            </button>
          )}
          <button
            className={`${danger ? "danger-action" : "primary-button"} action-standard`}
            disabled={busy}
            onClick={() => void runAction(onConfirm)}
          >
            <Check size={15} />
            {busy ? "处理中" : confirmLabel}
          </button>
        </div>
        {error && <p className="mt-3 text-anywhere text-sm leading-6 text-red-400" role="alert">{error}</p>}
      </section>
    </div>
  );
}

type PromptDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<void> | void;
};

export function PromptDialog({
  open,
  title,
  description,
  initialValue = "",
  placeholder,
  confirmLabel = "保存",
  cancelLabel = "取消",
  onCancel,
  onSubmit,
}: PromptDialogProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      setBusy(false);
      setError("");
      return;
    }

    setValue(initialValue);
    setError("");
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
  }, [initialValue, open]);

  const submit = async () => {
    const nextValue = value.trim();
    if (!nextValue || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(nextValue);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "操作失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onCancel();
      if (event.key === "Enter") {
        event.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open, submit]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-surface max-h-[min(92vh,540px)] w-full max-w-md overflow-y-auto p-5 scrollbar-thin"
        role="dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink" id={titleId}>
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-anywhere text-sm leading-6 text-ink/52" id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <button
            className="soft-button icon-action-compact"
            disabled={busy}
            onClick={onCancel}
            title="关闭"
            aria-label="关闭"
          >
            <X size={15} />
          </button>
        </div>
        <input
          autoFocus
          className="field-control field-prominent mt-4 w-full"
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          ref={inputRef}
          value={value}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-action action-standard" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className="primary-button action-standard"
            disabled={busy || !value.trim()}
            onClick={() => void submit()}
          >
            <Check size={15} />
            {busy ? "处理中" : confirmLabel}
          </button>
        </div>
        {error && <p className="mt-3 text-anywhere text-sm leading-6 text-red-400" role="alert">{error}</p>}
      </section>
    </div>
  );
}
