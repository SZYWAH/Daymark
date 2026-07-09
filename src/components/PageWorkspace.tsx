import {
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";

type PageWorkspaceProps = {
  eyebrow: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  leftRail?: ReactNode;
  rightRail?: ReactNode;
  className?: string;
  compactHeader?: boolean;
  fixedBody?: boolean;
  homeHeader?: boolean;
};

export function PageWorkspace({
  eyebrow,
  title,
  description,
  meta,
  actions,
  children,
  leftRail,
  rightRail,
  className = "",
  compactHeader = false,
  fixedBody = false,
  homeHeader = false,
}: PageWorkspaceProps) {
  return (
    <section className={`workspace-surface ${className}`}>
      <TopStatusBar
        eyebrow={eyebrow}
        title={title}
        description={description}
        meta={meta}
        actions={actions}
        compact={compactHeader}
        home={homeHeader}
      />
      <div className={`min-h-0 flex-1 bg-paper ${fixedBody ? "overflow-hidden" : "overflow-y-auto scrollbar-thin xl:overflow-hidden"}`}>
        <div className="flex min-h-full flex-col xl:h-full xl:min-h-0 xl:flex-row">
          {leftRail}
          <PrimaryPane>{children}</PrimaryPane>
          {rightRail}
        </div>
      </div>
    </section>
  );
}

export function TopStatusBar({
  eyebrow,
  title,
  description,
  meta,
  actions,
  compact = false,
  home = false,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  home?: boolean;
}) {
  return (
    <header className={`top-status-bar ${compact ? "top-status-bar-compact" : ""} ${home ? "top-status-bar-home" : ""}`}>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-ink/42">{eyebrow}</p>
        <div className={`${compact ? "mt-1" : "mt-2"} flex min-w-0 flex-wrap items-end gap-4`}>
          <h2 className={`min-w-0 font-semibold tracking-normal text-ink ${home ? "text-[18px] lg:text-[22px]" : compact ? "text-[26px] lg:text-[30px]" : "text-[30px] lg:text-[38px]"}`}>{title}</h2>
          {meta && <div className="min-w-0 max-w-xs truncate text-sm text-ink/46">{meta}</div>}
        </div>
        {description && <p className={`mt-1 max-w-2xl leading-5 text-ink/46 ${home ? "text-xs" : "text-sm"}`}>{description}</p>}
      </div>
      {actions && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">{actions}</div>}
    </header>
  );
}

export function PrimaryPane({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <main className={`primary-pane ${className}`}>{children}</main>;
}

export function PageMetricColumn({
  title,
  children,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <aside className={`page-metric-column ${className}`}>
      {title && <div className="mb-5 text-xs font-semibold uppercase tracking-[0.16em] text-ink/52">{title}</div>}
      <div className="metric-stack space-y-6">{children}</div>
    </aside>
  );
}

export function MetricItem({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <div className="metric-item border-b border-line/70 pb-5 last:border-b-0">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/55">{label}</div>
      <div className="metric-item-value mt-2 text-2xl font-semibold text-ink">{value}</div>
      {detail && <div className="metric-item-detail mt-1 text-sm leading-6 text-ink/50">{detail}</div>}
    </div>
  );
}

export function CollapsibleRail({
  title,
  icon: Icon,
  side = "right",
  collapsed,
  width,
  onToggle,
  onResizeStart,
  children,
  className = "",
}: {
  title: string;
  icon?: LucideIcon;
  side?: "left" | "right";
  collapsed: boolean;
  width?: number;
  onToggle: () => void;
  onResizeStart?: (event: ReactMouseEvent) => void;
  children: ReactNode;
  className?: string;
}) {
  const ToggleIcon = side === "left"
    ? collapsed ? PanelLeftOpen : PanelLeftClose
    : collapsed ? PanelRightOpen : PanelRightClose;

  if (collapsed) {
    return (
      <aside className={`collapsed-rail ${side === "left" ? "order-first" : ""}`}>
        <button className="soft-button flex h-10 w-10 items-center justify-center" onClick={onToggle} title={`展开${title}`} aria-label={`展开${title}`}>
          <ToggleIcon size={16} />
        </button>
        <span className="collapsed-rail-label text-[11px] font-medium text-ink/42">{title}</span>
      </aside>
    );
  }

  const railStyle = width ? ({ "--rail-width": `${width}px` } as CSSProperties) : undefined;

  return (
    <>
      {side === "right" && onResizeStart && <div className="resize-handle hidden h-full shrink-0 xl:block" onMouseDown={onResizeStart} />}
      <aside className={`workspace-rail ${className}`} style={railStyle}>
        <div className="rail-header">
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <Icon size={15} className="text-ink/48" />}
            <span className="truncate text-xs font-semibold uppercase tracking-[0.12em] text-ink/48">{title}</span>
          </div>
          <button className="soft-button flex h-8 w-8 items-center justify-center" onClick={onToggle} title={`收起${title}`} aria-label={`收起${title}`}>
            <ToggleIcon size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">{children}</div>
      </aside>
      {side === "left" && onResizeStart && <div className="resize-handle hidden h-full shrink-0 xl:block" onMouseDown={onResizeStart} />}
    </>
  );
}

export function PanelZoomButton({ onClick, title = "放大查看" }: { onClick: () => void; title?: string }) {
  return (
    <button className="soft-button flex h-8 w-8 items-center justify-center" onClick={onClick} title={title} aria-label={title}>
      <Maximize2 size={14} />
    </button>
  );
}
