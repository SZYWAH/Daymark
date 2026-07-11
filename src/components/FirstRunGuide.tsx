import { ArrowRight, FileUp, Library, MessagesSquare, PenLine, ShieldCheck, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

export type OnboardingStartAction = "record" | "import" | "ai-review";

type FirstRunGuideProps = {
  open: boolean;
  onStart: (action: OnboardingStartAction) => boolean;
  onDismiss: () => void;
};

export function FirstRunGuide({ open, onStart, onDismiss }: FirstRunGuideProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const primaryButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(true);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return undefined;

    restoreFocusRef.current = true;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => primaryButtonRef.current?.focus(), 0);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", handleEscape);
      if (restoreFocusRef.current) previousFocus?.focus();
    };
  }, [onDismiss, open]);

  if (!open) return null;

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;

    const focusable = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
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

  const start = (action: OnboardingStartAction) => {
    restoreFocusRef.current = false;
    if (!onStart(action)) restoreFocusRef.current = true;
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialogRef}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="first-run-guide modal-surface max-h-[calc(100dvh-2rem)] w-full max-w-[520px] overflow-y-auto p-5 scrollbar-thin sm:p-6"
        onKeyDown={trapFocus}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-normal text-copper">Daymark</p>
            <h2 className="mt-2 text-[22px] font-semibold leading-[30px] text-ink" id={titleId}>
              把今天做过的事，变成明天找得到的记忆。
            </h2>
          </div>
          <button
            className="soft-button icon-action-compact"
            onClick={onDismiss}
            title="关闭使用引导"
            aria-label="关闭使用引导"
          >
            <X size={15} />
          </button>
        </div>

        <p className="mt-3 text-sm leading-6 text-ink/60" id={descriptionId}>
          Daymark 是一个本地优先的工作记忆工具，用来记录当下、整理资料，并把 AI 对话沉淀为每日回顾与长期记忆。
        </p>

        <ol className="mt-4 flex items-center text-sm font-medium text-ink/70">
          <li className="flex min-w-0 flex-1 items-center">
            <span>记录</span>
          </li>
          <ArrowRight className="mx-2 shrink-0 text-ink/30" size={14} aria-hidden="true" />
          <li className="flex min-w-0 flex-1 items-center justify-center">
            <span>每日回顾</span>
          </li>
          <ArrowRight className="mx-2 shrink-0 text-ink/30" size={14} aria-hidden="true" />
          <li className="flex min-w-0 flex-1 items-center justify-end">
            <span>长期记忆</span>
          </li>
        </ol>

        <div className="mt-5 space-y-2">
          <button
            ref={primaryButtonRef}
            className="primary-action action-prominent w-full"
            onClick={() => start("record")}
          >
            <PenLine size={16} />
            开始记录
          </button>
          <div className="grid gap-2 sm:grid-cols-2">
            <button className="secondary-action action-standard w-full" onClick={() => start("import")}>
              <FileUp size={16} />
              导入资料
            </button>
            <button className="secondary-action action-standard w-full" onClick={() => start("ai-review")}>
              <MessagesSquare size={16} />
              整理 AI 对话
            </button>
          </div>
        </div>

        <div className="mt-4 border-t border-line pt-3">
          <div className="min-w-0 space-y-1.5 text-xs leading-5 text-ink/42">
            <p className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
              <span>内容默认保存在本机；主动使用 AI 整理时才会发送相关内容。</span>
            </p>
            <p className="flex items-start gap-2">
              <Library className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
              <span>资料库已准备 9 条示例资料，可在设置中随时删除。</span>
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
