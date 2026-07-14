import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";

type AiConnectionConfigDialogProps = {
  open: boolean;
  busy?: boolean;
  onRequestClose: () => void;
  children: ReactNode;
  footer: ReactNode;
};

export function AiConnectionConfigDialog({
  open,
  busy = false,
  onRequestClose,
  children,
  footer,
}: AiConnectionConfigDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const focusInitialControl = window.setTimeout(() => {
      dialog?.querySelector<HTMLElement>("[data-ai-config-start] button:not([disabled]), [data-ai-config-start] input:not([disabled])")?.focus();
    }, 30);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onRequestClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusInitialControl);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onRequestClose, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-surface flex max-h-[86vh] w-full max-w-[760px] flex-col"
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-panel/70 px-5 py-3">
          <div className="min-w-0">
            <h3 id={titleId} className="text-sm font-semibold text-ink">AI 连接</h3>
            <p id={descriptionId} className="mt-0.5 text-xs leading-5 text-ink/48">
              配置模型、协议和当前连接凭据。真实 API Key 不会回显。
            </p>
          </div>
          <button
            type="button"
            className="ghost-action icon-action-compact shrink-0"
            disabled={busy}
            onClick={onRequestClose}
            title="关闭 AI 配置"
            aria-label="关闭 AI 配置"
          >
            <X size={15} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">{children}</div>
        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-panel/70 px-5 py-3">
          {footer}
        </footer>
      </section>
    </div>
  );
}
