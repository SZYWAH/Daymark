import type { CodexReviewProgress } from "../ai/deepseek";

export function ReviewProgressIndicator({ progress }: { progress: CodexReviewProgress }) {
  const indicator = progress.indicator;
  if (!indicator) return null;

  const percent = Math.min(100, Math.max(0, indicator.percent ?? 0));
  return (
    <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/[0.08]" aria-hidden="true">
      <div
        className={indicator.mode === "indeterminate"
          ? "review-progress-indeterminate h-full rounded-full bg-accent"
          : "h-full rounded-full bg-accent transition-[width] duration-200"}
        style={indicator.mode === "indeterminate" ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
