import type { ReactNode } from "react";

type ScrollableResultPanelProps = {
  title?: ReactNode;
  count?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  empty?: ReactNode;
  fill?: boolean;
  maxHeightClass?: string;
  className?: string;
  bodyClassName?: string;
};

export function ScrollableResultPanel({
  title,
  count,
  status,
  actions,
  children,
  empty,
  fill = false,
  maxHeightClass = "max-h-[320px]",
  className = "",
  bodyClassName = "",
}: ScrollableResultPanelProps) {
  const hasHeader = title || count !== undefined || status || actions;

  return (
    <section className={`bounded-result-panel ${fill ? "h-full min-h-0 flex-1" : ""} ${className}`}>
      {hasHeader && (
        <ResultToolbar title={title} count={count} status={status} actions={actions} />
      )}
      <div
        className={`min-h-0 overflow-x-hidden overflow-y-auto p-2 scrollbar-thin ${fill ? "flex-1" : maxHeightClass} ${bodyClassName}`}
      >
        {empty ?? children}
      </div>
    </section>
  );
}

export function ResultToolbar({
  title,
  count,
  status,
  actions,
}: {
  title?: ReactNode;
  count?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="result-toolbar">
      <div className="min-w-0">
        {title && <div className="truncate text-xs font-semibold text-ink/70">{title}</div>}
        {status && <div className="mt-0.5 truncate text-[11px] text-ink/42">{status}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {count !== undefined && <span className="text-[11px] text-ink/42">{count}</span>}
        {actions}
      </div>
    </div>
  );
}

export function ResultRow({
  id,
  children,
  onClick,
  selected = false,
  disabled = false,
  className = "",
}: {
  id?: string;
  children: ReactNode;
  onClick?: () => void;
  selected?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const rowClass = `result-row ${selected ? "result-row-selected" : ""} ${className}`;

  if (onClick) {
    return (
      <button id={id} type="button" className={`${rowClass} w-full text-left`} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    );
  }

  return <article id={id} className={rowClass}>{children}</article>;
}

export function BoundedPreview({
  children,
  expanded = false,
  maxLinesClass = "line-clamp-3",
  expandedClassName = "max-h-[360px] overflow-y-auto pr-1 scrollbar-thin",
  className = "",
}: {
  children: ReactNode;
  expanded?: boolean;
  maxLinesClass?: string;
  expandedClassName?: string;
  className?: string;
}) {
  return (
    <div className={`text-anywhere ${expanded ? `whitespace-pre-wrap ${expandedClassName}` : maxLinesClass} ${className}`}>
      {children}
    </div>
  );
}
