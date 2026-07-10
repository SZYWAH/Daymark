import { PanelLeftClose, Plus, Search, Star } from "lucide-react";
import { animate } from "animejs";
import { useEffect, useRef } from "react";
import { getFolderPath } from "../lib/folders";
import {
  PROCESS_STATUSES,
  type ActiveView,
  type FolderNode,
  type Item,
  type ProcessStatus,
} from "../types";
import { typeMeta } from "../ui/itemMeta";

type ItemListProps = {
  items: Item[];
  allItems: Item[];
  folders: FolderNode[];
  activeView: ActiveView;
  selectedId: string;
  loading: boolean;
  error: string;
  query: string;
  statusFilter: ProcessStatus | "all";
  onQueryChange: (value: string) => void;
  onStatusFilterChange: (value: ProcessStatus | "all") => void;
  onCreateItem: () => void;
  onCollapse?: () => void;
  onSelectItem: (item: Item) => void;
  compact?: boolean;
};

const statuses: Array<ProcessStatus | "all"> = ["all", ...PROCESS_STATUSES];
const smartViewsWithBuiltInFilters = new Set(["attention", "inbox", "unfiled", "reading"]);

export function ItemList({
  items,
  folders,
  activeView,
  selectedId,
  loading,
  error,
  query,
  statusFilter,
  onQueryChange,
  onStatusFilterChange,
  onCreateItem,
  onCollapse,
  onSelectItem,
  compact = false,
}: ItemListProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const cards = listRef.current?.querySelectorAll(".item-card");
    if (!cards?.length) return;

    Array.from(cards)
      .slice(0, 12)
      .forEach((card, index) => {
        animate(card, {
          opacity: [0, 1],
          translateY: [8, 0],
          duration: 220,
          delay: index * 24,
          easing: "outQuad",
        });
      });
  }, [activeView, query, statusFilter, items.length]);

  const handleSearchFocus = () => {
    if (!searchRef.current) return;
    animate(searchRef.current, {
      scale: [1, 1.004],
      duration: 160,
      easing: "outQuad",
    });
  };

  const handleSearchBlur = () => {
    if (!searchRef.current) return;
    animate(searchRef.current, {
      scale: [1.004, 1],
      duration: 160,
      easing: "outQuad",
    });
  };
  const showStatusTabs = !compact && !(activeView.kind === "smart" && smartViewsWithBuiltInFilters.has(activeView.id));

  return (
    <section className="workspace-surface min-w-0 overflow-hidden">
      <header className={`workspace-header px-3 ${compact ? "py-2" : "py-3"}`}>
        <div className={`${compact ? "mb-1.5" : "mb-2"} flex items-center justify-between gap-2`}>
          {compact ? (
            <div className="min-w-0 text-sm font-medium text-ink/72">资料列表</div>
          ) : (
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-copper">{getViewEyebrow(activeView)}</p>
              <h2 className="poetic-heading mt-0.5 truncate text-lg">{getViewTitle(activeView, folders)}</h2>
            </div>
          )}
          <div className="flex items-center gap-2">
            {onCollapse && (
              <button className={`soft-button icon-action-compact ${compact ? "inline-flex" : "hidden xl:inline-flex"}`} title="收起列表" aria-label="收起资料列表" onClick={onCollapse}>
                <PanelLeftClose size={16} />
              </button>
            )}
            {!compact && (
              <button
                className="primary-button action-compact"
                onClick={onCreateItem}
              >
                <Plus size={16} />
                导入资料
              </button>
            )}
          </div>
        </div>

        <div ref={searchRef} className="field-control field-standard flex items-center gap-2">
          <Search size={16} className="text-ink/50" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
            placeholder="搜索标题、正文、标签、路径或 AI 摘要"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink/35"
          />
        </div>

        {!compact && (
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5 overflow-hidden pr-8">
            <LibraryContextHeader activeView={activeView} folders={folders} count={items.length} />
          </div>
        )}
      </header>

      {showStatusTabs && (
        <div className="max-w-full min-w-0 overflow-hidden border-b border-line">
          <div className={`flex max-w-full overflow-x-auto px-3 py-2 pr-8 scrollbar-thin ${compact ? "gap-3" : "gap-4"}`}>
            {statuses.map((status) => (
              <button
                key={status}
                className={`shrink-0 border-b py-1 text-center text-xs font-medium transition ${
                  statusFilter === status
                    ? "border-copper text-ink"
                    : "border-transparent text-ink/50 hover:border-line hover:text-ink"
                }`}
                onClick={() => onStatusFilterChange(status)}
              >
                {status === "all" ? "全部" : status}
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-paper/30 px-2.5 pb-20 pt-2.5 scrollbar-thin sm:pb-2.5">
        {loading ? (
          <EmptyState title="正在读取本地数据" description="正在打开你的资料库。" />
        ) : error ? (
          <EmptyState title="读取失败" description={error} />
        ) : items.length === 0 ? (
          <EmptyState
            title={query.trim() ? "没有匹配的资料" : getEmptyTitle(activeView)}
            description={query.trim() ? "换个关键词试试，或清空搜索回到当前资料视图。" : getEmptyDescription(activeView)}
            actionLabel="导入资料"
            onAction={onCreateItem}
          />
        ) : (
          items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              folders={folders}
              selected={selectedId === item.id}
              onClick={() => onSelectItem(item)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function LibraryContextHeader({
  activeView,
  folders,
  count,
}: {
  activeView: ActiveView;
  folders: FolderNode[];
  count: number;
}) {
  const path =
    activeView.kind === "folder"
      ? getFolderPath(folders, activeView.folderId).join(" / ")
      : getViewTitle(activeView, folders);

  return (
    <div className="flex min-w-[200px] flex-1 flex-wrap items-center justify-between gap-2 text-[11px] text-ink/55">
      <span className="truncate">
        当前位置：<span className="font-medium text-ink/70">{path}</span>
      </span>
      <span className="font-medium text-ink/55">{count} 条资料</span>
    </div>
  );
}

function ItemCard({
  item,
  folders,
  selected,
  onClick,
}: {
  item: Item;
  folders: FolderNode[];
  selected: boolean;
  onClick: () => void;
}) {
  const meta = typeMeta[item.type];
  const TypeIcon = meta.icon;
  const folderPath = getFolderPath(folders, item.folderId).join(" / ") || "未归档";

  return (
    <article
      role="button"
      tabIndex={0}
      className={`item-card library-card group type-${item.type} block w-full cursor-pointer px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper/35 ${
        selected ? "selected-card" : ""
      }`}
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      aria-selected={selected}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <span className={`type-mark ${meta.color}`}>
            <TypeIcon size={14} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="poetic-heading truncate text-[14px] leading-5">{item.title}</h3>
            <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-ink/50">
              <span className="truncate">{folderPath}</span>
              <span className="shrink-0">更新 {item.updatedAt}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="text-[11px] text-ink/60">{item.processStatus}</span>
          {item.favorite ? <Star size={14} className="fill-copper text-copper" /> : null}
        </div>
      </div>
    </article>
  );
}

function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center border-t border-line/70 bg-transparent p-6 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-2 max-w-[26rem] text-sm leading-6 text-ink/52">{description}</p>
      {actionLabel && onAction && (
        <button className="secondary-action action-standard mt-5" onClick={onAction}>
          <Plus size={16} />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function getEmptyTitle(activeView: ActiveView) {
  if (activeView.kind === "folder") return "这个目录还没有资料";
  if (activeView.kind === "smart") {
    if (activeView.id === "attention") return "当前没有待处理资料";
    if (activeView.id === "inbox") return "收件箱是空的";
    if (activeView.id === "favorite") return "还没有收藏资料";
    if (activeView.id === "reading") return "暂时没有待读资料";
  }
  return "资料库还是空的";
}

function getEmptyDescription(activeView: ActiveView) {
  if (activeView.kind === "folder") return "可以把新资料直接导入到这个目录，或从别处移动过来。";
  if (activeView.kind === "smart") {
    if (activeView.id === "attention") return "需要整理、阅读或补充标签的内容会出现在这里。";
    if (activeView.id === "inbox") return "新导入但还没归位的资料会先放在这里。";
    if (activeView.id === "favorite") return "点击资料右上角的星标后，它会出现在这里。";
    if (activeView.id === "reading") return "标记为待读的资料会在这里聚拢。";
  }
  return "导入一份文档、链接或知识卡片，就可以开始整理。";
}

function getViewEyebrow(activeView: ActiveView) {
  if (activeView.kind === "folder") return "Library folder";
  if (activeView.kind === "item") return "Reader";
  return "Library";
}

function getViewTitle(activeView: ActiveView, folders: FolderNode[]) {
  if (activeView.kind === "item") return "条目";
  if (activeView.kind === "folder") {
    return folders.find((folder) => folder.id === activeView.folderId)?.title ?? "未命名文件夹";
  }

  if (activeView.kind !== "smart") return "资料库";

  const titles: Record<string, string> = {
    attention: "待处理",
    inbox: "收件箱",
    unfiled: "未归档",
    recent: "最近打开",
    favorite: "收藏",
    reading: "待读",
  };

  return titles[activeView.id];
}
