import {
  Brain,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Home,
  Layers3,
  Library,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getChildFolders, getFolderAggregateItemCounts } from "../lib/folders";
import { typeMeta } from "../ui/itemMeta";
import type { ActiveView, FolderNode, Item } from "../types";

type SidebarProps = {
  folders: FolderNode[];
  items: Item[];
  activeView: ActiveView;
  selectedItemId?: string;
  showItemLeaves?: boolean;
  collapsed: boolean;
  width: number;
  onSelectView: (view: ActiveView) => void;
  onSelectItem: (item: Item) => void;
  onCreateFolder: (parentId?: string) => void;
  onRenameFolder: (folder: FolderNode) => void;
  onDeleteFolder: (folder: FolderNode) => void;
  onToggleCollapsed: () => void;
  onResizeStart: (event: ReactMouseEvent) => void;
  onResetLayout: () => void;
  sourceChangedItemIds?: ReadonlySet<string>;
};

export function Sidebar({
  folders,
  items,
  activeView,
  selectedItemId,
  showItemLeaves = true,
  collapsed,
  width,
  onSelectView,
  onSelectItem,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleCollapsed,
  onResizeStart,
  onResetLayout,
  sourceChangedItemIds,
}: SidebarProps) {
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(folders.filter((folder) => !folder.parentId).map((folder) => folder.id)),
  );
  const libraryActive = activeView.kind === "smart" || activeView.kind === "folder" || activeView.kind === "item";

  const itemCounts = useMemo(() => {
    return getFolderAggregateItemCounts(folders, items);
  }, [folders, items]);

  const itemsByFolder = useMemo(() => {
    const grouped = new Map<string, Item[]>();
    items.forEach((item) => {
      if (!item.folderId) return;
      const current = grouped.get(item.folderId) ?? [];
      current.push(item);
      grouped.set(item.folderId, current);
    });
    grouped.forEach((folderItems) => {
      folderItems.sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));
    });
    return grouped;
  }, [items]);

  const toggleFolder = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const sidebarStyle = { width, minWidth: width };

  if (libraryActive) {
    return (
      <>
        <LibraryGlobalRail activeView={activeView} onSelectView={onSelectView} />
        {!collapsed && (
          <aside className="sidebar-surface overflow-hidden" style={sidebarStyle}>
            <div className="mb-4 flex items-center gap-2 border-b border-line px-1 pb-3 text-ink">
              <span className="text-sm font-semibold">资料库</span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  className="soft-button icon-action-compact"
                  onMouseDown={onResizeStart}
                  title="拖动调整目录宽度"
                  aria-label="拖动调整目录宽度"
                >
                  <span className="h-4 w-1 rounded-full bg-line" />
                </button>
                <button
                  className="soft-button icon-action-compact"
                  onClick={onToggleCollapsed}
                  title="折叠目录"
                  aria-label="折叠目录"
                >
                  <PanelLeftClose size={15} />
                </button>
                <button
                  className="soft-button icon-action-compact text-[11px]"
                  onClick={onResetLayout}
                  title="重置布局"
                  aria-label="重置布局"
                >
                  ↺
                </button>
              </div>
            </div>

            <nav className="min-h-0 flex-1 overflow-y-auto pr-1 scrollbar-thin">
              <div>
                <div className="mb-2 flex items-center justify-between border-b border-line px-1 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/38">目录</p>
                  <button
                    className="flex h-7 w-7 items-center justify-center rounded-[8px] text-ink/45 transition hover:bg-surface/80 hover:text-ink"
                    onClick={() => onCreateFolder()}
                    title="新建顶层文件夹"
                    aria-label="新建顶层文件夹"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="space-y-0.5">
                  {getChildFolders(folders).length === 0 ? (
                    <div className="rounded-[8px] border border-dashed border-line bg-panel/55 px-3 py-4 text-xs leading-5 text-ink/70">
                      还没有项目目录。点击上方加号，先建一个安放资料的地方。
                    </div>
                  ) : getChildFolders(folders).map((folder) => (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      folders={folders}
                      itemsByFolder={itemsByFolder}
                      expanded={expanded}
                      itemCounts={itemCounts}
                      activeView={activeView}
                      selectedItemId={selectedItemId}
                      showItemLeaves={showItemLeaves}
                      sourceChangedItemIds={sourceChangedItemIds}
                      depth={0}
                      onToggle={toggleFolder}
                      onSelectView={onSelectView}
                      onSelectItem={onSelectItem}
                      onCreateFolder={onCreateFolder}
                      onRenameFolder={onRenameFolder}
                      onDeleteFolder={onDeleteFolder}
                    />
                  ))}
                </div>
              </div>
            </nav>
          </aside>
        )}
      </>
    );
  }

  if (collapsed) {
    return (
      <aside className="sidebar-surface items-center overflow-hidden px-2" style={sidebarStyle}>
        <button
          className="soft-button icon-action-standard mb-3"
          onClick={onToggleCollapsed}
          title="展开侧栏"
          aria-label="展开侧栏"
        >
          <PanelLeftOpen size={16} />
        </button>
        <nav className="space-y-2">
          <CollapsedNavButton
            active={activeView.kind === "today"}
            icon={Home}
            label="今日"
            onClick={() => onSelectView({ kind: "today" })}
          />
          <CollapsedNavButton
            active={activeView.kind === "search"}
            icon={Search}
            label="搜索"
            onClick={() => onSelectView({ kind: "search" })}
          />
          <CollapsedNavButton
            active={activeView.kind === "journal"}
            icon={FileText}
            label="日志"
            onClick={() => onSelectView({ kind: "journal" })}
          />
          <CollapsedNavButton
            active={libraryActive}
            icon={Library}
            label="资料库"
            onClick={() => onSelectView({ kind: "smart", id: "attention" })}
          />
          <CollapsedNavButton
            active={activeView.kind === "memory"}
            icon={Brain}
            label="记忆"
            onClick={() => onSelectView({ kind: "memory" })}
          />
          <CollapsedNavButton
            active={activeView.kind === "settings"}
            icon={Settings}
            label="设置"
            onClick={() => onSelectView({ kind: "settings" })}
          />
        </nav>
      </aside>
    );
  }

  return (
    <aside className="sidebar-surface overflow-hidden" style={sidebarStyle}>
      <div className="mb-3 flex items-center justify-end gap-2">
        <button
          className="soft-button icon-action-compact"
          onMouseDown={onResizeStart}
          title="拖动调整侧栏宽度"
          aria-label="拖动调整侧栏宽度"
        >
          <span className="h-4 w-1 rounded-full bg-line" />
        </button>
        <button
          className="soft-button icon-action-compact"
          onClick={onToggleCollapsed}
          title="折叠侧栏"
          aria-label="折叠侧栏"
        >
          <PanelLeftClose size={15} />
        </button>
        <button
          className="soft-button icon-action-compact text-[11px]"
          onClick={onResetLayout}
          title="重置布局"
          aria-label="重置布局"
        >
          ↺
        </button>
      </div>
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-line text-ink/70">
          <Layers3 size={18} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">个人知识库</h1>
          <p className="truncate text-xs text-ink/48">日志 · 资料 · 记忆</p>
        </div>
      </div>

      <nav className="mb-4 space-y-1">
        <PrimaryNavButton
          active={activeView.kind === "today"}
          icon={Home}
          label="今日"
          onClick={() => onSelectView({ kind: "today" })}
        />
        <PrimaryNavButton
          active={activeView.kind === "search"}
          icon={Search}
          label="搜索"
          onClick={() => onSelectView({ kind: "search" })}
        />
        <PrimaryNavButton
          active={activeView.kind === "journal"}
          icon={FileText}
          label="日志"
          onClick={() => onSelectView({ kind: "journal" })}
        />
        <PrimaryNavButton
          active={libraryActive}
          icon={Library}
          label="资料库"
          onClick={() => onSelectView({ kind: "smart", id: "attention" })}
        />
        <PrimaryNavButton
          active={activeView.kind === "memory"}
          icon={Brain}
          label="记忆"
          onClick={() => onSelectView({ kind: "memory" })}
        />
        <PrimaryNavButton
          active={activeView.kind === "settings"}
          icon={Settings}
          label="设置"
          onClick={() => onSelectView({ kind: "settings" })}
        />
      </nav>
    </aside>
  );
}

function LibraryGlobalRail({
  activeView,
  onSelectView,
}: {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
}) {
  return (
    <aside
      className="sidebar-surface items-center overflow-hidden px-2"
      style={{ width: 64, minWidth: 64 }}
      aria-label="全局功能栏"
    >
      <div
        className="mb-4 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-line text-ink/70"
        title="Daymark"
        aria-hidden="true"
      >
        <Layers3 size={18} />
      </div>
      <nav className="space-y-2" aria-label="主导航">
        <CollapsedNavButton
          active={activeView.kind === "today"}
          icon={Home}
          label="今日"
          onClick={() => onSelectView({ kind: "today" })}
        />
        <CollapsedNavButton
          active={activeView.kind === "search"}
          icon={Search}
          label="搜索"
          onClick={() => onSelectView({ kind: "search" })}
        />
        <CollapsedNavButton
          active={activeView.kind === "journal"}
          icon={FileText}
          label="日志"
          onClick={() => onSelectView({ kind: "journal" })}
        />
        <CollapsedNavButton
          active={activeView.kind === "smart" || activeView.kind === "folder" || activeView.kind === "item"}
          icon={Library}
          label="资料库"
          onClick={() => onSelectView({ kind: "smart", id: "attention" })}
        />
        <CollapsedNavButton
          active={activeView.kind === "memory"}
          icon={Brain}
          label="记忆"
          onClick={() => onSelectView({ kind: "memory" })}
        />
        <CollapsedNavButton
          active={activeView.kind === "settings"}
          icon={Settings}
          label="设置"
          onClick={() => onSelectView({ kind: "settings" })}
        />
      </nav>
    </aside>
  );
}

export function MobileGlobalNav({
  activeView,
  onSelectView,
}: {
  activeView: ActiveView;
  onSelectView: (view: ActiveView) => void;
}) {
  const libraryActive = activeView.kind === "smart" || activeView.kind === "folder" || activeView.kind === "item";
  const entries: Array<{ label: string; icon: LucideIcon; active: boolean; onClick: () => void }> = [
    { label: "今日", icon: Home, active: activeView.kind === "today", onClick: () => onSelectView({ kind: "today" }) },
    { label: "搜索", icon: Search, active: activeView.kind === "search", onClick: () => onSelectView({ kind: "search" }) },
    { label: "日志", icon: FileText, active: activeView.kind === "journal", onClick: () => onSelectView({ kind: "journal" }) },
    { label: "资料", icon: Library, active: libraryActive, onClick: () => onSelectView({ kind: "smart", id: "attention" }) },
    { label: "记忆", icon: Brain, active: activeView.kind === "memory", onClick: () => onSelectView({ kind: "memory" }) },
    { label: "设置", icon: Settings, active: activeView.kind === "settings", onClick: () => onSelectView({ kind: "settings" }) },
  ];

  return (
    <nav className="mobile-global-nav" aria-label="主导航">
      {entries.map(({ label, icon: Icon, active, onClick }) => (
        <button
          key={label}
          className={`mobile-global-nav-button ${active ? "mobile-global-nav-button-active" : ""}`}
          onClick={onClick}
          type="button"
        >
          <Icon size={17} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

function PrimaryNavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-9 w-full items-center gap-2 rounded-[8px] px-3 text-left text-sm ${
        active ? "nav-row-active" : "nav-row"
      }`}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
}

function CollapsedNavButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-10 w-10 items-center justify-center rounded-[8px] ${
        active ? "nav-row-active" : "nav-row"
      }`}
      onClick={onClick}
      title={label}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={17} />
      <span className="sr-only">{label}</span>
    </button>
  );
}

type FolderRowProps = {
  folder: FolderNode;
  folders: FolderNode[];
  itemsByFolder: Map<string, Item[]>;
  expanded: Set<string>;
  itemCounts: Map<string, number>;
  activeView: ActiveView;
  selectedItemId?: string;
  showItemLeaves: boolean;
  sourceChangedItemIds?: ReadonlySet<string>;
  depth: number;
  onToggle: (id: string) => void;
  onSelectView: (view: ActiveView) => void;
  onSelectItem: (item: Item) => void;
  onCreateFolder: (parentId?: string) => void;
  onRenameFolder: (folder: FolderNode) => void;
  onDeleteFolder: (folder: FolderNode) => void;
};

function FolderRow({
  folder,
  folders,
  itemsByFolder,
  expanded,
  itemCounts,
  activeView,
  selectedItemId,
  showItemLeaves,
  sourceChangedItemIds,
  depth,
  onToggle,
  onSelectView,
  onSelectItem,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
}: FolderRowProps) {
  const children = getChildFolders(folders, folder.id);
  const folderItems = itemsByFolder.get(folder.id) ?? [];
  const visibleFolderItems = showItemLeaves ? folderItems : [];
  const hasChildren = children.length > 0 || visibleFolderItems.length > 0;
  const open = expanded.has(folder.id);
  const active = activeView.kind === "folder" && activeView.folderId === folder.id;
  const FolderIcon = open ? FolderOpen : Folder;
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!actionsOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActionsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [actionsOpen]);

  return (
    <div>
      <div
        ref={actionsRef}
        className={`folder-tree-row group relative flex h-8 items-center gap-1 rounded-[8px] pr-1 text-sm ${
          active ? "nav-row-active" : "nav-row"
        }`}
        data-folder-depth={Math.min(depth, 2)}
        style={{ paddingLeft: `${depth * 12 + 2}px` }}
      >
        {hasChildren ? (
          <button
            className="flex h-7 w-5 items-center justify-center rounded-[6px]"
            onClick={() => onToggle(folder.id)}
            aria-label={`${open ? "收起" : "展开"}目录 ${folder.title}`}
            aria-expanded={open}
          >
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="flex h-7 w-5 items-center justify-center" aria-hidden="true"><span className="w-3" /></span>
        )}
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onDoubleClick={() => onRenameFolder(folder)}
          onClick={() => onSelectView({ kind: "folder", folderId: folder.id })}
        >
          <FolderIcon size={depth === 0 ? 16 : 15} />
          <span className="truncate">{folder.title}</span>
        </button>
        <span className={active ? "nav-count nav-count-active" : "nav-count"}>
          {itemCounts.get(folder.id) ?? 0}
        </span>
        <button
          className={`h-7 w-7 items-center justify-center rounded-[6px] text-ink/42 transition hover:bg-surface/80 hover:text-ink ${actionsOpen ? "flex" : "hidden group-hover:flex"}`}
          onClick={(event) => {
            event.stopPropagation();
            setActionsOpen((value) => !value);
          }}
          title="文件夹操作"
          aria-label="文件夹操作"
          aria-expanded={actionsOpen}
        >
          <MoreHorizontal size={14} />
        </button>
        {actionsOpen && (
          <div className="absolute right-1 top-8 z-30 min-w-[132px] rounded-[8px] border border-line bg-surface p-1.5 shadow-panel">
            <button
              className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-xs text-ink/70 transition hover:bg-panel hover:text-ink"
              onClick={(event) => {
                event.stopPropagation();
                setActionsOpen(false);
                onCreateFolder(folder.id);
              }}
            >
              <Plus size={13} />
              新建子目录
            </button>
            <button
              className="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-left text-xs text-ink/70 transition hover:bg-panel hover:text-ink"
              onClick={(event) => {
                event.stopPropagation();
                setActionsOpen(false);
                onRenameFolder(folder);
              }}
            >
              <Pencil size={13} />
              重命名
            </button>
            <button
              className="danger-icon-action action-compact w-full justify-start text-left"
              aria-label={`删除目录 ${folder.title}`}
              onClick={(event) => {
                event.stopPropagation();
                setActionsOpen(false);
                onDeleteFolder(folder);
              }}
            >
              <Trash2 size={13} />
              删除
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="relative mt-0.5 space-y-0.5">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1 top-1 w-px bg-line/55"
            style={{ left: `${(depth + 1) * 12 + 8}px` }}
          />
          {children.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              folders={folders}
              itemsByFolder={itemsByFolder}
              expanded={expanded}
              itemCounts={itemCounts}
              activeView={activeView}
              selectedItemId={selectedItemId}
              showItemLeaves={showItemLeaves}
              sourceChangedItemIds={sourceChangedItemIds}
              depth={depth + 1}
              onToggle={onToggle}
              onSelectView={onSelectView}
              onSelectItem={onSelectItem}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
            />
          ))}
          {visibleFolderItems.map((item) => (
            <ItemLeaf
              key={item.id}
              item={item}
              active={activeView.kind === "item" && activeView.itemId === item.id}
              selected={selectedItemId === item.id}
              sourceChanged={sourceChangedItemIds?.has(item.id) ?? false}
              depth={depth + 1}
              onSelectItem={onSelectItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ItemLeaf({
  item,
  active,
  selected,
  sourceChanged,
  depth,
  onSelectItem,
}: {
  item: Item;
  active: boolean;
  selected: boolean;
  sourceChanged: boolean;
  depth: number;
  onSelectItem: (item: Item) => void;
}) {
  const meta = typeMeta[item.type];
  const ItemIcon = meta.icon ?? FileText;

  return (
    <button
      className={`flex h-7 w-full items-center gap-1.5 rounded-[8px] pr-2 text-left text-xs transition ${
        active || selected ? "bg-copper/10 text-copper shadow-sm ring-1 ring-copper/15" : "text-ink/56 hover:bg-surface/80 hover:text-ink"
      }`}
      style={{ paddingLeft: `${depth * 12 + 23}px` }}
      onClick={() => onSelectItem(item)}
      title={item.title}
    >
      <ItemIcon size={13} className="shrink-0" />
      <span className="truncate">{item.title}</span>
      {sourceChanged ? (
        <span className="ml-auto shrink-0 whitespace-nowrap text-[10px] font-medium text-copper">来源有更新</span>
      ) : null}
    </button>
  );
}
