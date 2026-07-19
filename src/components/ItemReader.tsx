import {
  Archive,
  Bot,
  BookOpen,
  Box,
  CheckCircle2,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  FolderKanban,
  FolderOpen,
  GitCompareArrows,
  Globe2,
  Heading1,
  History,
  Image,
  Link2,
  ListChecks,
  PanelLeft,
  Sparkles,
  Star,
  Tags,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FolderPicker } from "./FolderPicker";
import { LinkPanel } from "./LinkPanel";
import { SelectMenu } from "./SelectMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import { MarkdownContent } from "./MarkdownContent";
import { checkLocalPath, openExternalUrl, openLocalPath, revealLocalPath, type PathStatus } from "../lib/desktop";
import { getFolderPath } from "../lib/folders";
import { extractMarkdownOutline } from "../lib/markdown";
import {
  extractItemReferenceContexts,
  getItemTargetRef,
  resolveItemReferences,
} from "../lib/itemReferences";
import { getSafeErrorMessage } from "../lib/redaction";
import {
  getDailyReviewLibraryRevision,
  getDailyReviewLibraryRevisionKind,
  isDailyReviewLibraryItemEdited,
  type DailyReviewLibraryRevisionKind,
  type DailyReviewLibraryState,
} from "../lib/reviewLibraryPublication";
import {
  PROCESS_STATUSES,
  READING_STATUSES,
  type AiAction,
  type AiRunDisplayState,
  type AiRunReceipt,
  type DailyConversationReview,
  type EntityKind,
  type FolderNode,
  type Item,
  type ItemType,
  type JournalEntry,
  type KnowledgeLink,
  type ManualKnowledgeLinkInput,
  type MemoryCard,
  type ProcessStatus,
  type ReadingStatus,
  type SummaryReport,
} from "../types";
import { ReviewLibraryHistoryDialog } from "./ReviewLibraryHistoryDialog";
import {
  ReviewLibraryUpdateDialog,
  type ReviewLibraryUpdateContext,
  type ReviewLibraryUpdateDraft,
  type ReviewLibraryUpdateMode,
} from "./ReviewLibraryUpdateDialog";

export type ReviewLibraryReaderState = DailyReviewLibraryState & {
  reviewTypeLabel?: string;
};

export type ItemReaderProps = {
  item?: Item;
  folders: FolderNode[];
  items: Item[];
  journalEntries: JournalEntry[];
  memories: MemoryCard[];
  reports: SummaryReport[];
  links: KnowledgeLink[];
  aiRunningAction: AiAction | null;
  aiRunState: AiRunDisplayState | null;
  showBackButton?: boolean;
  backLabel?: string;
  onBackToList: () => void;
  onEdit: () => void;
  onCreate: () => void;
  onDelete: () => void;
  onToggleFavorite: () => Promise<void> | void;
  onMoveItem: (folderId?: string) => Promise<void> | void;
  onUpdateItem: (patch: Partial<Item>) => Promise<void> | void;
  onRunAiAction: (action: AiAction) => void;
  onCancelAiAction: () => void;
  onCreateLink: (input: ManualKnowledgeLinkInput) => Promise<void>;
  onDeleteLink: (id: string) => Promise<void>;
  onOpenEntity: (kind: EntityKind, id: string) => void;
  onOpenItemReference?: (itemId: string) => void;
  reviewLibraryState?: ReviewLibraryReaderState | null;
  onOpenReviewSource?: (reviewId: string) => Promise<void> | void;
  onOpenReviewLibraryItem?: (itemId: string) => Promise<void> | void;
  onApplyReviewLibraryUpdate?: (
    mode: ReviewLibraryUpdateMode,
    draft: ReviewLibraryUpdateDraft,
    context: ReviewLibraryUpdateContext,
  ) => Promise<void> | void;
  onRestoreReviewLibraryVersion?: (version: Item, expectedCurrentItem: Item) => Promise<void> | void;
};

const PROCESS_ORGANIZED = PROCESS_STATUSES[2];
const READING_TO_READ = READING_STATUSES[1];
const READING_DONE = READING_STATUSES[3];

const typeMeta: Record<ItemType, { label: string; icon: LucideIcon; color: string }> = {
  note: { label: "知识卡片", icon: FileText, color: "border-line bg-panel text-ink/65" },
  document: { label: "文档", icon: Box, color: "border-line bg-panel text-ink/65" },
  archive: { label: "压缩包", icon: Archive, color: "border-line bg-panel text-ink/65" },
  url: { label: "网页", icon: Globe2, color: "border-line bg-panel text-ink/65" },
  image: { label: "图片", icon: Image, color: "border-line bg-panel text-ink/65" },
  project: { label: "项目", icon: FolderKanban, color: "border-line bg-panel text-ink/65" },
};

const processLabels = ["收件箱", "待整理", "已整理", "已归档", "废弃"];
const readingLabels = ["不需要", "待阅读", "阅读中", "已阅读", "需复习"];

const aiActions: Array<{ id: AiAction; label: string; description: string; icon: LucideIcon }> = [
  { id: "summarize", label: "总结", description: "提炼正文和文件内容", icon: FileText },
  { id: "title", label: "标题", description: "生成更清晰的标题", icon: Heading1 },
  { id: "tags", label: "标签", description: "补充可检索标签", icon: Tags },
  { id: "todos", label: "待办", description: "提取后续动作", icon: ListChecks },
];

export function ItemReader({
  item,
  folders,
  items,
  journalEntries,
  memories,
  reports,
  links,
  aiRunningAction,
  aiRunState,
  showBackButton = true,
  backLabel = "返回列表",
  onBackToList,
  onEdit,
  onCreate,
  onDelete,
  onToggleFavorite,
  onMoveItem,
  onUpdateItem,
  onRunAiAction,
  onCancelAiAction,
  onCreateLink,
  onDeleteLink,
  onOpenEntity,
  onOpenItemReference,
  reviewLibraryState,
  onOpenReviewSource,
  onOpenReviewLibraryItem,
  onApplyReviewLibraryUpdate,
  onRestoreReviewLibraryVersion,
}: ItemReaderProps) {
  const [pathStatus, setPathStatus] = useState<PathStatus | null>(null);
  const [fileActionMessage, setFileActionMessage] = useState("");
  const [readerMessage, setReaderMessage] = useState("");
  const [reviewUpdateOpen, setReviewUpdateOpen] = useState(false);
  const [reviewHistoryOpen, setReviewHistoryOpen] = useState(false);
  const completionRef = useRef<HTMLDivElement | null>(null);

  const folderLabel = item?.folderId ? getFolderPath(folders, item.folderId).join(" / ") : "未归档";
  const itemLinks = useMemo(
    () =>
      item
        ? links.filter((link) =>
            (link.linkKind ?? "manual") === "manual"
            && (
              (link.sourceKind === "item" && link.sourceId === item.id)
              || (link.targetKind === "item" && link.targetId === item.id)
            ))
        : [],
    [item, links],
  );
  const outline = useMemo(() => (item ? extractMarkdownOutline(item.content || item.aiSummary || "") : []), [item]);
  const hasAiSummary = item ? hasUsefulAiSummary(item.aiSummary) : false;

  useEffect(() => {
    let cancelled = false;
    setPathStatus(null);
    if (!item?.filePath) return undefined;

    void checkLocalPath(item.filePath)
      .then((status) => {
        if (!cancelled) setPathStatus(status);
      })
      .catch((error) => {
        if (!cancelled) {
          setPathStatus({ exists: false, message: getSafeErrorMessage(error, "无法检查路径") });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [item?.filePath]);

  if (!item) {
    return (
      <section className="workspace-surface">
        <div className="flex h-full flex-col items-center justify-center px-6 text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[10px] text-ink/38">
            <FileText size={22} />
          </div>
          <h2 className="text-lg font-semibold text-ink">选择一条资料</h2>
          <p className="mt-2 max-w-[24rem] text-sm leading-6 text-ink/52">资料详情会在这里阅读、整理和运行 AI 操作。</p>
          <button className="secondary-action action-standard mt-5" onClick={onCreate}>
            导入资料
          </button>
        </div>
      </section>
    );
  }

  const complete = Boolean(item.folderId) && item.tags.length > 0 && item.processStatus === PROCESS_ORGANIZED;

  const handleCopyPath = async () => {
    const value = item.filePath ?? item.sourceUrl ?? "";
    if (!value) return;
    setFileActionMessage("");
    try {
      await navigator.clipboard.writeText(value);
      setFileActionMessage("路径已复制。");
    } catch (error) {
      setFileActionMessage(getSafeErrorMessage(error, "复制失败，请稍后再试。"));
    }
  };

  const handleDesktopAction = async (action: () => Promise<void>, successMessage: string) => {
    setFileActionMessage("");
    try {
      await action();
      setFileActionMessage(successMessage);
    } catch (error) {
      setFileActionMessage(getSafeErrorMessage(error, "操作失败，请检查路径或权限。"));
    }
  };

  const handleToggleFavorite = async () => {
    setReaderMessage("");
    try {
      await onToggleFavorite();
      setReaderMessage(item.favorite ? "已取消收藏。" : "已收藏。");
    } catch (error) {
      setReaderMessage(getSafeErrorMessage(error, "收藏状态更新失败，请稍后再试。"));
    }
  };

  return (
    <section className="workspace-surface">
      <ReaderHero
        item={item}
        folderLabel={folderLabel}
        showBackButton={showBackButton}
        backLabel={backLabel}
        onBackToList={onBackToList}
        onEdit={onEdit}
        onToggleFavorite={handleToggleFavorite}
      />
      {readerMessage && <div className="shrink-0 border-b border-line/60 px-5 py-2 text-xs text-ink/54">{readerMessage}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto bg-paper px-5 pb-24 pt-4 scrollbar-thin lg:pb-4">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4">
          <ReaderSection icon={FileText} title="阅读">
            <div className="reader-content-body max-h-[min(62vh,720px)] overflow-y-auto pr-1 scrollbar-thin">
              <MarkdownContent
                content={item.content}
                currentItemId={item.id}
                items={items}
                onOpenItem={onOpenItemReference}
              />
            </div>
          </ReaderSection>

          {item.origin?.kind === "daily-review" && reviewLibraryState && (
            <ReviewLibrarySourceCard
              item={item}
              state={reviewLibraryState}
              onOpenSource={onOpenReviewSource}
              onOpenCurrent={onOpenReviewLibraryItem}
              onOpenUpdate={() => setReviewUpdateOpen(true)}
              onOpenHistory={() => setReviewHistoryOpen(true)}
              onRestore={onRestoreReviewLibraryVersion}
              canUpdate={Boolean(onApplyReviewLibraryUpdate)}
            />
          )}

          <ReaderWorkbench
            item={item}
            folders={folders}
            folderLabel={folderLabel}
            outlineCount={outline.length}
            linkCount={itemLinks.length}
            complete={complete}
            completionRef={completionRef}
            aiRunningAction={aiRunningAction}
            aiRunState={aiRunState}
            onMoveItem={onMoveItem}
            onUpdateItem={onUpdateItem}
            onEdit={onEdit}
            onDelete={onDelete}
            onRunAiAction={onRunAiAction}
            onCancelAiAction={onCancelAiAction}
          />

          {(item.filePath || item.sourceUrl) && (
            <AttachmentStrip
              item={item}
              pathStatus={pathStatus}
              fileActionMessage={fileActionMessage}
              onCopyPath={handleCopyPath}
              onOpenPath={() => void handleDesktopAction(() => openLocalPath(item.filePath ?? ""), "已请求系统打开文件。")}
              onRevealPath={() => void handleDesktopAction(() => revealLocalPath(item.filePath ?? ""), "已请求定位到文件位置。")}
              onOpenUrl={() => void handleDesktopAction(() => openExternalUrl(item.sourceUrl ?? ""), "已请求打开链接。")}
            />
          )}

          {hasAiSummary && (
            <ReaderSection icon={Bot} title="AI 摘要">
              <div className="reader-content-body text-anywhere text-sm leading-7 text-ink/70">
                {item.aiSummary}
              </div>
            </ReaderSection>
          )}

          {(item.todos?.length ?? 0) > 0 && (
            <ReaderSection icon={CheckCircle2} title="待办">
              <div className="space-y-2 text-sm text-ink/70">
                {(item.todos ?? []).map((todo) => (
                  <div key={todo} className="flex gap-2">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50" />
                    <span className="min-w-0 text-anywhere">{todo}</span>
                  </div>
                ))}
              </div>
            </ReaderSection>
          )}

          <ReaderReferencePanels
            item={item}
            outline={outline}
            links={links}
            items={items}
            journalEntries={journalEntries}
            memories={memories}
            reports={reports}
            onCreateLink={onCreateLink}
            onDeleteLink={onDeleteLink}
            onOpenEntity={onOpenEntity}
            onOpenItemReference={onOpenItemReference ?? ((itemId) => onOpenEntity("item", itemId))}
          />
        </div>
      </div>

      <ReviewLibraryUpdateDialog
        folders={folders}
        items={items}
        open={reviewUpdateOpen}
        item={reviewLibraryState?.head ?? null}
        source={reviewLibraryState?.source ?? null}
        onClose={() => setReviewUpdateOpen(false)}
        onSubmit={async (mode, draft, context) => {
          if (!onApplyReviewLibraryUpdate) throw new Error("当前页面尚未接入资料更新操作。");
          await onApplyReviewLibraryUpdate(mode, draft, context);
        }}
      />
      <ReviewLibraryHistoryDialog
        open={reviewHistoryOpen}
        displayedItemId={item.id}
        currentItem={reviewLibraryState?.head ?? null}
        versions={reviewLibraryState?.versions ?? []}
        onClose={() => setReviewHistoryOpen(false)}
        onOpenItem={async (itemId) => {
          if (!onOpenReviewLibraryItem) throw new Error("当前页面尚未接入资料版本导航。");
          await onOpenReviewLibraryItem(itemId);
        }}
        onRestore={async (version, expectedCurrentItem) => {
          if (!onRestoreReviewLibraryVersion) throw new Error("当前页面尚未接入资料版本恢复。");
          await onRestoreReviewLibraryVersion(version, expectedCurrentItem);
        }}
      />
    </section>
  );
}

function ReaderHero({
  item,
  folderLabel,
  showBackButton,
  backLabel,
  onBackToList,
  onEdit,
  onToggleFavorite,
}: {
  item: Item;
  folderLabel: string;
  showBackButton: boolean;
  backLabel: string;
  onBackToList: () => void;
  onEdit: () => void;
  onToggleFavorite: () => void;
}) {
  const meta = typeMeta[item.type];
  const TypeIcon = meta.icon;
  const visibleTags = item.tags.slice(0, 7);
  const hiddenTagCount = Math.max(item.tags.length - visibleTags.length, 0);

  return (
    <header className="workspace-header px-5 py-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
            {showBackButton && (
              <button className="soft-button action-compact mr-1" onClick={onBackToList} aria-label={backLabel} title={backLabel}>
                <PanelLeft size={14} />
                {backLabel}
              </button>
            )}
            <span className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium ${meta.color}`}>
              <TypeIcon size={12} />
              {meta.label}
            </span>
            <span className="quiet-chip py-0.5 text-[11px]">{labelForStatus(PROCESS_STATUSES, processLabels, item.processStatus)}</span>
            <span className="quiet-chip py-0.5 text-[11px]">{labelForStatus(READING_STATUSES, readingLabels, item.readingStatus)}</span>
          </div>
          <h2 className="poetic-heading line-clamp-2 text-anywhere text-[24px] leading-8 lg:text-[30px]" title={item.title}>{item.title}</h2>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink/45">
            <span className="max-w-[42rem] truncate">
              位置：<span className="text-ink/62">{folderLabel}</span>
            </span>
            <span>
              更新：<span className="text-ink/62">{item.updatedAt}</span>
            </span>
            {visibleTags.map((tag) => (
              <span key={tag} className="quiet-chip py-0.5 text-[11px] text-ink/52">
                #{tag}
              </span>
            ))}
            {hiddenTagCount > 0 && <span className="quiet-chip py-0.5 text-[11px] text-ink/42">+{hiddenTagCount}</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button className="soft-button icon-action-compact" onClick={onToggleFavorite} title={item.favorite ? "取消收藏" : "收藏"} aria-label={item.favorite ? "取消收藏这份资料" : "收藏这份资料"}>
            <Star size={15} className={item.favorite ? "fill-ink text-ink" : ""} />
          </button>
          <button className="secondary-action action-compact" onClick={onEdit}>
            <Edit3 size={14} />
            编辑
          </button>
        </div>
      </div>
    </header>
  );
}

function ReaderWorkbench({
  item,
  folders,
  folderLabel,
  outlineCount,
  linkCount,
  complete,
  completionRef,
  aiRunningAction,
  aiRunState,
  onMoveItem,
  onUpdateItem,
  onEdit,
  onDelete,
  onRunAiAction,
  onCancelAiAction,
}: {
  item: Item;
  folders: FolderNode[];
  folderLabel: string;
  outlineCount: number;
  linkCount: number;
  complete: boolean;
  completionRef: React.RefObject<HTMLDivElement | null>;
  aiRunningAction: AiAction | null;
  aiRunState: AiRunDisplayState | null;
  onMoveItem: (folderId?: string) => Promise<void> | void;
  onUpdateItem: (patch: Partial<Item>) => Promise<void> | void;
  onEdit: () => void;
  onDelete: () => void;
  onRunAiAction: (action: AiAction) => void;
  onCancelAiAction: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [aiToolsOpen, setAiToolsOpen] = useState(false);
  const [message, setMessage] = useState("");
  const readingNeedsAttention = item.readingStatus !== READING_DONE && item.readingStatus !== READING_STATUSES[0];
  const missing = getOrganizeMissingParts(item);

  const updateItem = async (patch: Partial<Item>) => {
    setMessage("");
    try {
      await onUpdateItem(patch);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "更新失败，请稍后再试。"));
    }
  };

  const moveItem = async (folderId?: string) => {
    setMessage("");
    try {
      await onMoveItem(folderId);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "移动失败，请稍后再试。"));
    }
  };

  return (
    <section className="reader-control-panel">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs text-ink/48">
          <span className="flex items-center gap-1.5 font-medium text-ink/68">
            <Sparkles size={14} />
            资料操作
          </span>
          {!complete && missing.length > 0 && <span>待补 {missing.length}</span>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            className={`${complete ? "secondary-action" : "primary-action"} action-compact reader-workbench-toggle disabled:cursor-not-allowed disabled:opacity-60 ${panelOpen ? "reader-workbench-toggle-open" : ""}`}
            aria-expanded={panelOpen}
            onClick={() => {
              setPanelOpen((value) => !value);
              setAiToolsOpen(false);
            }}
          >
            <Sparkles size={14} />
            {aiRunningAction ? "处理中" : "AI 整理"}
          </button>
          {aiRunningAction && (
            <button className="soft-button action-compact" type="button" onClick={onCancelAiAction}>
              停止
            </button>
          )}
        </div>
      </div>

      {panelOpen && (
        <div className="reader-control-details">
          <div className="grid min-w-0 gap-2 lg:grid-cols-[minmax(0,1fr)_170px_170px]">
            <FolderPicker folders={folders} value={item.folderId} onChange={(folderId) => void moveItem(folderId)} placeholder="移动到目录" />
            <SelectMenu
              value={item.processStatus}
              options={PROCESS_STATUSES.map((status, index) => ({ value: status, label: `整理：${processLabels[index] ?? status}` }))}
              onChange={(value) => void updateItem({ processStatus: value as ProcessStatus })}
            />
            <SelectMenu
              value={item.readingStatus}
              options={READING_STATUSES.map((status, index) => ({ value: status, label: `阅读：${readingLabels[index] ?? status}` }))}
              onChange={(value) => void updateItem({ readingStatus: value as ReadingStatus })}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            {complete ? (
              <div ref={completionRef} className="text-sm text-ink/62">
                已整理：位置、状态和标签都已经足够清楚。
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium text-ink/70">下一步</span>
                {missing.map((part) => (
                  <span key={part} className="quiet-chip py-0.5 text-[11px] text-ink/54">
                    {part}
                  </span>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <IconTextButton icon={CheckCircle2} label="已整理" onClick={() => void updateItem({ processStatus: PROCESS_ORGANIZED })} />
              <IconTextButton
                icon={BookOpen}
                label={readingNeedsAttention ? "已读" : "待阅读"}
                onClick={() => void updateItem({ readingStatus: readingNeedsAttention ? READING_DONE : READING_TO_READ })}
              />
              <IconTextButton icon={Edit3} label="补标签" onClick={onEdit} />
            </div>
          </div>
          <div className="mt-2 border-t border-line/60 pt-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-3 text-xs text-ink/38">
                <span>相关 {linkCount}</span>
                <span>大纲 {outlineCount}</span>
              </div>
              <button
                className={`soft-button action-compact ${aiToolsOpen ? "active-toggle" : ""}`}
                type="button"
                onClick={() => setAiToolsOpen((value) => !value)}
              >
                AI 工具
              </button>
            </div>
            {aiToolsOpen && (
              <div className="mt-2 rounded-[8px] border border-line/60 bg-surface/45 p-2">
                <div className="grid min-w-0 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                  {aiActions.map((action) => {
                    const ActionIcon = action.icon;
                    return (
                      <button
                        key={action.id}
                        className="reader-ai-action-button action-compact justify-start text-left disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={Boolean(aiRunningAction)}
                        title={action.description}
                        onClick={() => {
                          onRunAiAction(action.id);
                          setPanelOpen(false);
                          setAiToolsOpen(false);
                        }}
                      >
                        <ActionIcon size={14} className="shrink-0" />
                        <span className="min-w-0">
                          <span className="block leading-5">{aiRunningAction === action.id ? "处理中" : action.label}</span>
                          <span className="sr-only">{action.description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs leading-5 text-ink/42">手动触发；处理范围会显示在处理记录中。</p>
              </div>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line/60 pt-2">
            <span className="text-xs text-ink/38">删除前会要求确认。</span>
            <button className="danger-action action-compact" onClick={onDelete} title="删除资料" aria-label="删除资料">
              <Trash2 size={15} />
              删除资料
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-2 text-xs leading-5 text-red-400">{message}</p>}
      {aiRunState && <AiResultPanel state={aiRunState} resultPersisted={aiRunState.status === "success" && aiRunState.receipt?.action === "summarize" && hasUsefulAiSummary(item.aiSummary)} />}
    </section>
  );
}

function ReaderSection({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <section className="reader-content-block">
      <div className="reader-content-label">
        <Icon size={16} />
        {title}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function ReviewLibrarySourceCard({
  item,
  state,
  canUpdate,
  onOpenSource,
  onOpenCurrent,
  onOpenUpdate,
  onOpenHistory,
  onRestore,
}: {
  item: Item;
  state: ReviewLibraryReaderState;
  canUpdate: boolean;
  onOpenSource?: (reviewId: string) => Promise<void> | void;
  onOpenCurrent?: (itemId: string) => Promise<void> | void;
  onOpenUpdate: () => void;
  onOpenHistory: () => void;
  onRestore?: (version: Item, expectedCurrentItem: Item) => Promise<void> | void;
}) {
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const origin = item.origin;
  const revision = getDailyReviewLibraryRevision(item);
  const currentRevision = getDailyReviewLibraryRevision(state.head);
  const isCurrent = item.id === state.head.id;
  const itemEditedSinceSync = isDailyReviewLibraryItemEdited(item);
  const sourceAvailable = Boolean(state.source);
  const typeLabel = state.reviewTypeLabel
    ?? (state.source ? getDailyReviewTypeLabel(state.source) : inferDailyReviewTypeLabel(origin?.sourceKey));

  const statusMeta = !isCurrent
    ? {
        label: "历史版本",
        className: "border-line bg-panel text-ink/58",
        description: `当前版本为版本 ${currentRevision}；这个历史版本不会出现在普通资料列表和搜索结果中。`,
      }
    : state.status === "source-changed"
      ? {
          label: "来源有更新",
          className: "border-copper/30 bg-copper/10 text-copper",
          description: "正式回顾已经变化。资料不会自动覆盖，可先对比再决定更新方式。",
        }
      : state.status === "source-missing"
        ? {
            label: "来源缺失",
            className: "border-line bg-panel text-ink/58",
            description: "来源回顾不在本机，资料和版本历史仍可继续使用。",
          }
        : {
            label: "已同步",
            className: "border-moss/30 bg-moss/10 text-moss",
            description: "资料对应当前正式回顾版本，后续变化仍需手动确认同步。",
          };

  return (
    <ReaderSection icon={Link2} title="回顾来源">
      <div className="rounded-[8px] border border-line bg-panel/65 p-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusMeta.className}`}>{statusMeta.label}</span>
              <span className="quiet-chip py-0.5 text-[11px]">版本 {revision}</span>
              <span className="quiet-chip py-0.5 text-[11px]">{revisionKindLabel(getDailyReviewLibraryRevisionKind(item))}</span>
              {itemEditedSinceSync && (
                <span className="rounded-full border border-copper/30 bg-copper/10 px-2 py-0.5 text-[11px] font-medium text-copper">
                  同步后有本地编辑
                </span>
              )}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs leading-5 text-ink/48">
              <span>日期：<span className="text-ink/68">{origin?.sourceDate || state.source?.date || "未知"}</span></span>
              <span>来源：<span className="text-ink/68">{origin?.sourceLabel || state.source?.sourceLabel || "未知来源"}</span></span>
              <span>类型：<span className="text-ink/68">{typeLabel}</span></span>
              <span>共 <span className="text-ink/68">{Math.max(state.versions.length, 1)}</span> 个版本</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-ink/55">{statusMeta.description}</p>
            {state.status === "source-missing" && (
              <p className="mt-1 text-xs leading-5 text-ink/45" role="status">
                来源回顾不在本机，查看原回顾和对比更新暂不可用。
              </p>
            )}
            {itemEditedSinceSync && (
              <p className="mt-1 text-xs leading-5 text-ink/45">本地编辑不会自动丢失；对比弹窗会让你确认最终写入内容。</p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            {isCurrent ? (
              <>
                <button
                  className="soft-button action-compact disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={!sourceAvailable || !onOpenSource}
                  onClick={() => {
                    if (sourceAvailable && onOpenSource) void onOpenSource(state.source!.id);
                  }}
                  title={sourceAvailable ? "查看原回顾" : "来源回顾不在本机"}
                >
                  查看原回顾
                </button>
                {(state.status === "source-changed" || state.status === "source-missing") && (
                  <button
                    className="primary-button action-compact disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={!canUpdate || !sourceAvailable}
                    onClick={onOpenUpdate}
                    title={sourceAvailable ? "对比最新来源并选择更新方式" : "来源回顾不在本机"}
                  >
                    <GitCompareArrows size={14} />
                    对比更新
                  </button>
                )}
              </>
            ) : (
              <>
                {onOpenCurrent && (
                  <button className="secondary-action action-compact" onClick={() => void onOpenCurrent(state.head.id)}>
                    打开当前版本
                  </button>
                )}
                {onRestore && (
                  <button className="primary-button action-compact" onClick={() => setRestoreConfirmOpen(true)}>
                    恢复为新版本
                  </button>
                )}
              </>
            )}
            <button className="soft-button action-compact" onClick={onOpenHistory}>
              <History size={14} />
              版本历史
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={restoreConfirmOpen}
        title={`恢复版本 ${revision}？`}
        message="将以这个历史版本当前的标题和正文创建新版本；正式回顾、当前资料和已有历史版本都不会被修改。"
        confirmLabel="恢复为新版本"
        onCancel={() => setRestoreConfirmOpen(false)}
        onConfirm={async () => {
          if (!onRestore) return;
          await onRestore(item, state.head);
          setRestoreConfirmOpen(false);
        }}
      />
    </ReaderSection>
  );
}

function getDailyReviewTypeLabel(review: DailyConversationReview) {
  if (review.reviewKind === "combined") return "综合回顾";
  if (review.reviewKind === "auto-work") return "自动工作回顾";
  return "单来源回顾";
}

function inferDailyReviewTypeLabel(sourceKey?: string) {
  const reviewKind = sourceKey?.split(":")[1];
  if (reviewKind === "combined") return "综合回顾";
  if (reviewKind === "auto-work") return "自动工作回顾";
  if (reviewKind === "source") return "单来源回顾";
  return "AI 每日回顾";
}

function revisionKindLabel(kind: DailyReviewLibraryRevisionKind) {
  if (kind === "restore") return "恢复版本";
  if (kind === "reactivation") return "重新启用";
  return "来源版本";
}

function AttachmentStrip({
  item,
  pathStatus,
  fileActionMessage,
  onCopyPath,
  onOpenPath,
  onRevealPath,
  onOpenUrl,
}: {
  item: Item;
  pathStatus: PathStatus | null;
  fileActionMessage: string;
  onCopyPath: () => void;
  onOpenPath: () => void;
  onRevealPath: () => void;
  onOpenUrl: () => void;
}) {
  return (
    <ReaderSection icon={Link2} title="附件 / 来源">
      <div className="space-y-3 text-sm text-ink/62">
        {item.filePath && (
          <div className="space-y-2">
            <div className="reader-info-strip grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <span className="font-medium text-ink/72">文件</span>
              <span className="min-w-0 truncate text-anywhere" title={item.filePath}>{item.filePath}</span>
              <span className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-1">
                <IconTextButton icon={Copy} label="复制" onClick={onCopyPath} />
                <IconTextButton icon={ExternalLink} label="打开" onClick={onOpenPath} />
                <IconTextButton icon={FolderOpen} label="定位" onClick={onRevealPath} />
              </span>
            </div>
            <PathStatusLine status={pathStatus} />
          </div>
        )}
        {item.sourceUrl && (
          <div className="reader-info-strip grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <span className="font-medium text-ink/72">网址</span>
            <span className="min-w-0 truncate text-anywhere" title={item.sourceUrl}>{item.sourceUrl}</span>
            <span className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-1">
              <IconTextButton icon={ExternalLink} label="打开链接" onClick={onOpenUrl} />
            </span>
          </div>
        )}
        {fileActionMessage && <div className="rounded-[8px] border border-line bg-panel px-3 py-2 text-xs leading-5 text-ink/58">{fileActionMessage}</div>}
      </div>
    </ReaderSection>
  );
}

function ReaderReferencePanels({
  item,
  outline,
  links,
  items,
  journalEntries,
  memories,
  reports,
  onCreateLink,
  onDeleteLink,
  onOpenEntity,
  onOpenItemReference,
}: {
  item: Item;
  outline: Array<{ level: number; text: string }>;
  links: KnowledgeLink[];
  items: Item[];
  journalEntries: JournalEntry[];
  memories: MemoryCard[];
  reports: SummaryReport[];
  onCreateLink: (input: ManualKnowledgeLinkInput) => Promise<void>;
  onDeleteLink: (id: string) => Promise<void>;
  onOpenEntity: (kind: EntityKind, id: string) => void;
  onOpenItemReference: (itemId: string) => void;
}) {
  const manualLinks = links.filter((link) => (link.linkKind ?? "manual") === "manual");
  const linkCount = manualLinks.filter(
    (link) =>
      (link.sourceKind === "item" && link.sourceId === item.id) ||
      (link.targetKind === "item" && link.targetId === item.id),
  ).length;
  const resolutions = resolveItemReferences(item.content, items, item.id);
  const outgoingByRef = new Map<string, (typeof resolutions)[number]>();
  resolutions.forEach((resolution) => {
    const key = resolution.token.targetRef ?? `unbound:${resolution.token.start}`;
    if (!outgoingByRef.has(key)) outgoingByRef.set(key, resolution);
  });
  const outgoing = Array.from(outgoingByRef.values()).filter((resolution) => resolution.status === "resolved" && resolution.item);
  const broken = Array.from(outgoingByRef.values()).filter((resolution) => resolution.status !== "resolved");
  const backlinks = links
    .filter((link) => link.linkKind === "inline" && link.targetId === item.id && link.sourceKind === "item")
    .map((link) => ({ link, source: items.find((candidate) => candidate.id === link.sourceId) }))
    .filter((entry): entry is { link: KnowledgeLink; source: Item } => Boolean(entry.source))
    .sort((left, right) => right.source.updatedAt.localeCompare(left.source.updatedAt));

  return (
    <details className="reader-collapsed-panel">
      <summary className="reader-collapsed-summary">
        <span>引用、关联与大纲</span>
        <span className="text-xs text-ink/38">
          正文引用 {outgoing.length} · 被引用 {backlinks.length} · 手动关联 {linkCount} · 大纲 {outline.length}
        </span>
      </summary>
      <div className="mt-3 grid min-w-0 gap-4 xl:grid-cols-2">
        <ReferenceList title="正文引用" empty="正文中还没有资料链接。">
          {outgoing.map((resolution) => (
            <button className="reader-info-strip w-full text-left" key={resolution.token.targetRef} onClick={() => onOpenItemReference(resolution.item!.id)}>
              <p className="truncate text-sm font-medium text-ink">{resolution.item!.title}</p>
              <p className="mt-0.5 truncate text-xs text-ink/42">{resolution.token.alias ? `别名：${resolution.token.alias}` : "跟随目标当前标题"}</p>
            </button>
          ))}
        </ReferenceList>
        <ReferenceList title="反向引用" empty="当前没有其他资料引用这里。">
          {backlinks.map(({ link, source }) => (
            <button className="reader-info-strip w-full text-left" key={link.id} onClick={() => onOpenItemReference(source.id)}>
              <p className="truncate text-sm font-medium text-ink">{source.title}</p>
              {extractItemReferenceContexts(source.content, link.targetRef ?? getItemTargetRef(item), items).map((context, index) => (
                <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink/46" key={`${link.id}-${index}`}>{context}</p>
              ))}
            </button>
          ))}
        </ReferenceList>
        <ReferenceList title="失效链接" empty="没有失效或未绑定的正文链接。">
          {broken.map((resolution) => (
            <div className="reader-info-strip" key={`${resolution.token.start}-${resolution.token.raw}`}>
              <p className="text-sm text-ink/55">{resolution.displayText}</p>
              <p className="mt-0.5 text-xs text-ink/38">{resolution.status === "self" ? "链接指向当前资料" : "链接目标不存在"}</p>
            </div>
          ))}
        </ReferenceList>
        <div className="min-w-0">
          <div className="mb-2 text-xs font-medium text-ink/42">手动关联</div>
          <LinkPanel
            entityKind="item"
            entityId={item.id}
            links={manualLinks}
            items={items}
            journalEntries={journalEntries}
            memories={memories}
            reports={reports}
            onCreateLink={onCreateLink}
            onDeleteLink={onDeleteLink}
            onOpenEntity={onOpenEntity}
          />
        </div>
        <div className="min-w-0 border-t border-line/70 pt-3 xl:col-span-2">
          <div className="mb-2 text-xs font-medium text-ink/42">文档大纲</div>
          <div className="max-h-[260px] space-y-1 overflow-y-auto pr-1 scrollbar-thin">
            {outline.length > 0 ? (
              outline.map((heading, index) => (
                <div
                  key={`${heading.text}-${index}`}
                  className="truncate text-anywhere text-sm text-ink/66"
                  style={{ paddingLeft: `${(heading.level - 1) * 14}px` }}
                >
                  {heading.text}
                </div>
              ))
            ) : (
              <div className="text-sm text-ink/42">这份资料暂时没有可识别的大纲。</div>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}

function ReferenceList({ title, empty, children }: { title: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <section className="min-w-0">
      <div className="mb-2 text-xs font-medium text-ink/42">{title}</div>
      <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1 scrollbar-thin">
        {hasChildren ? children : <p className="py-2 text-sm text-ink/42">{empty}</p>}
      </div>
    </section>
  );
}

function AiResultPanel({ state, resultPersisted = false }: { state: AiRunDisplayState; resultPersisted?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const receipt = state.receipt;
  const resultText = resultPersisted ? "" : state.resultText ?? "";
  const receiptSummary = receipt ? formatAiReceiptSummary(receipt) : "";
  const warning = state.status === "error";

  return (
    <div className={`mt-3 rounded-[8px] border border-line bg-surface/70 p-3 text-sm leading-6 text-ink/70 ${warning ? "text-ink/70" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className={`quiet-chip py-0.5 text-[11px] font-medium ${warning ? "text-red-300/80" : "text-ink/62"}`}>
          {getRunStatusLabel(state.status)}
        </span>
        {receipt?.fileName && <span className="quiet-chip max-w-full truncate py-0.5 text-[11px] text-ink/55">{receipt.fileName}</span>}
        {receipt?.providerLabel && <span className="quiet-chip py-0.5 text-[11px] text-ink/55">{receipt.providerLabel}</span>}
        {receipt?.model && <span className="quiet-chip py-0.5 text-[11px] text-ink/55">{receipt.model}</span>}
      </div>
      {receiptSummary && <div className="mb-3 rounded-[8px] border border-line bg-panel/70 px-3 py-2 text-xs leading-5 text-ink/66">{receiptSummary}</div>}
      <p className="text-xs leading-5 text-ink/56">{state.message}</p>
      {resultPersisted && (
        <p className="mt-2 text-xs leading-5 text-ink/48">AI 摘要已写入资料；处理记录仅显示读取、发送和返回统计。</p>
      )}
      {resultText && (
        <p className={`${expanded ? "max-h-[360px] overflow-y-auto whitespace-pre-wrap pr-2 scrollbar-thin" : "line-clamp-6"} mt-3 text-anywhere text-sm leading-6 text-ink/66`}>
          {resultText}
        </p>
      )}
      {state.preview && previewOpen && (
        <div className="mt-3 max-h-[220px] overflow-y-auto rounded-[8px] border border-line bg-paper px-3 py-2 text-xs leading-5 text-ink/54 scrollbar-thin">
          <div className="mb-1 text-ink/38">提取预览：这里只是片段，不代表发送长度。</div>
          <pre className="whitespace-pre-wrap text-anywhere font-sans">{state.preview}</pre>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {resultText && (
          <button className="ghost-action action-micro" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "收起结果" : "展开结果"}
          </button>
        )}
        {state.preview && (
          <button className="ghost-action action-micro" onClick={() => setPreviewOpen((value) => !value)}>
            {previewOpen ? "收起预览" : "查看提取预览"}
          </button>
        )}
      </div>
    </div>
  );
}

function IconTextButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button className="secondary-action action-compact" onClick={onClick}>
      <Icon size={14} />
      {label}
    </button>
  );
}

function PathStatusLine({ status }: { status: PathStatus | null }) {
  if (!status) return <div className="text-xs text-ink/38">正在检查路径。</div>;
  return (
    <div className={`text-xs ${status.exists ? "text-ink/45" : "text-red-300/80"}`}>
      {status.exists ? `路径有效：${status.kind === "directory" ? "目录" : "文件"}` : status.message ?? "路径不可用"}
    </div>
  );
}

function getOrganizeMissingParts(item: Item) {
  const missing: string[] = [];
  if (!item.folderId) missing.push("缺目录");
  if (item.processStatus !== PROCESS_ORGANIZED) missing.push(labelForStatus(PROCESS_STATUSES, processLabels, item.processStatus));
  if (item.tags.length === 0) missing.push("缺标签");
  if (item.readingStatus === READING_TO_READ) missing.push("待阅读");
  return missing.length > 0 ? missing : ["可长期保存"];
}

function labelForStatus<T extends readonly string[]>(values: T, labels: string[], value: T[number]) {
  const index = values.findIndex((item) => item === value);
  return labels[index] ?? value;
}

function hasUsefulAiSummary(value?: string) {
  const text = value?.trim() ?? "";
  return Boolean(text && text !== "等待 AI 摘要。");
}

function formatAiReceiptSummary(receipt: AiRunReceipt) {
  const hasTextStats = typeof receipt.extractedChars === "number" || typeof receipt.sentChars === "number";
  const outputPart = typeof receipt.outputChars === "number"
    ? `返回 ${receipt.outputChars.toLocaleString("zh-CN")} 字符`
    : "等待 AI 返回";
  const parts: string[] = [];

  if (hasTextStats) {
    const extracted = receipt.extractedChars ?? 0;
    const sent = receipt.sentChars ?? 0;
    parts.push(
      `已提取 ${extracted.toLocaleString("zh-CN")} 字符`,
      `实际发送 ${sent.toLocaleString("zh-CN")} 字符`,
      outputPart,
      receipt.truncated ? "已截断" : "未截断",
      receipt.redacted ? "已脱敏" : "未脱敏",
    );

    if (extracted > 0 && sent === extracted && !receipt.truncated) {
      parts.push("完整提取文本已用于本次请求");
    }
  } else {
    parts.push(
      receipt.fileName
        ? "已读取非文本资料输入，处理记录不按正文字符统计"
        : "本次操作使用资料库现有内容，没有读取本地文件正文",
      outputPart,
    );
    if (receipt.redacted) parts.push("已脱敏");
  }

  return parts.join("，") + "。";
}

function getRunStatusLabel(status: AiRunDisplayState["status"]) {
  if (status === "reading") return "读取中";
  if (status === "sending") return "发送中";
  if (status === "success") return "已完成";
  return "出错";
}
