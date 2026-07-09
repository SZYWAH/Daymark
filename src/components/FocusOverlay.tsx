import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function FocusOverlay({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop">
      <section aria-label={title} aria-modal="true" className="modal-surface flex max-h-[94vh] w-full max-w-6xl flex-col" role="dialog">
        <header className="flex items-center justify-between border-b border-line bg-panel/70 px-5 py-3">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-ink/45 transition hover:bg-panel hover:text-ink"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">{children}</div>
      </section>
    </div>
  );
}
