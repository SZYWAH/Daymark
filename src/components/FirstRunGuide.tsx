import { ArrowRight, FileUp, MessagesSquare, PenLine, ShieldCheck, X } from "lucide-react";
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
        className="modal-surface max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto p-5 scrollbar-thin sm:p-6"
        onKeyDown={trapFocus}
        role="dialog"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-copper">Daymark</p>
            <h2 className="mt-2 max-w-md text-xl font-semibold leading-8 text-ink" id={titleId}>
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

        <p className="mt-4 max-w-lg text-sm leading-7 text-ink/62" id={descriptionId}>
          Daymark 是一个本地优先的工作记忆工具。它把你的即时记录、资料，以及 Codex / Claude Code
          对话，整理成每日工作回顾和长期记忆。
        </p>

        <ol className="mt-6 flex flex-col gap-3 border-y border-line py-4 text-sm font-medium text-ink/72 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <li className="flex items-center gap-2">
            <span className="text-xs text-ink/35">01</span>
            <span>记录</span>
          </li>
          <ArrowRight className="hidden shrink-0 text-ink/28 sm:block" size={15} aria-hidden="true" />
          <li className="flex items-center gap-2">
            <span className="text-xs text-ink/35">02</span>
            <span>每日回顾</span>
          </li>
          <ArrowRight className="hidden shrink-0 text-ink/28 sm:block" size={15} aria-hidden="true" />
          <li className="flex items-center gap-2">
            <span className="text-xs text-ink/35">03</span>
            <span>长期记忆</span>
          </li>
        </ol>

        <div className="mt-5">
          <p className="mb-2 text-xs font-medium text-ink/48">选择一个开始方式</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <button
              ref={primaryButtonRef}
              className="secondary-action action-prominent w-full border-ink/25 bg-panel text-ink"
              onClick={() => start("record")}
            >
              <PenLine size={16} />
              开始记录
            </button>
            <button className="secondary-action action-prominent w-full" onClick={() => start("import")}>
              <FileUp size={16} />
              导入资料
            </button>
            <button className="secondary-action action-prominent w-full" onClick={() => start("ai-review")}>
              <MessagesSquare size={16} />
              整理 AI 对话
            </button>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex min-w-0 items-start gap-2 text-xs leading-5 text-ink/42">
            <ShieldCheck className="mt-0.5 shrink-0" size={14} aria-hidden="true" />
            <span>内容默认保存在本机；只有你主动使用 AI 整理时，相关内容才会发送到已配置的 AI 服务。</span>
          </p>
          <button
            className="ghost-action action-compact shrink-0 self-end border-line/60 bg-surface/25 text-ink/68 hover:bg-surface/70 sm:self-auto"
            onClick={onDismiss}
          >
            暂时跳过
          </button>
        </div>
      </section>
    </div>
  );
}
