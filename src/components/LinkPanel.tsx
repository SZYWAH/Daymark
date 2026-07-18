import { Brain, FileText, History, Link2, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoundedPreview, ResultRow, ScrollableResultPanel } from "./ResultPanels";
import { ConfirmDialog } from "./ConfirmDialog";
import { getSafeErrorMessage } from "../lib/redaction";
import { getVisibleDailyReviewLibraryItems } from "../lib/reviewLibraryPublication";
import type { EntityKind, Item, JournalEntry, KnowledgeLink, MemoryCard, SummaryReport } from "../types";

type LinkInput = Omit<KnowledgeLink, "id" | "createdAt">;

type LinkPanelProps = {
  entityKind: EntityKind;
  entityId: string;
  links: KnowledgeLink[];
  items: Item[];
  journalEntries: JournalEntry[];
  memories: MemoryCard[];
  reports: SummaryReport[];
  onCreateLink: (input: LinkInput) => Promise<void>;
  onDeleteLink: (id: string) => Promise<void>;
  onOpenEntity: (kind: EntityKind, id: string) => void;
};

type LinkCandidate = {
  kind: EntityKind;
  id: string;
  title: string;
  subtitle: string;
};

const kindLabels: Record<EntityKind, string> = {
  journal: "日志",
  item: "资料",
  memory: "记忆",
  summary: "总结",
};

const kindIcons = {
  journal: FileText,
  item: Link2,
  memory: Brain,
  summary: History,
};

export function LinkPanel({
  entityKind,
  entityId,
  links,
  items,
  journalEntries,
  memories,
  reports,
  onCreateLink,
  onDeleteLink,
  onOpenEntity,
}: LinkPanelProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [relation, setRelation] = useState("相关");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState("");
  const [message, setMessage] = useState("");
  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, saving]);

  const relatedLinks = useMemo(
    () =>
      links.filter(
        (link) =>
          (link.sourceKind === entityKind && link.sourceId === entityId) ||
          (link.targetKind === entityKind && link.targetId === entityId),
      ),
    [entityId, entityKind, links],
  );

  const allCandidates = useMemo(
    () => buildCandidates(items, journalEntries, memories, reports),
    [items, journalEntries, memories, reports],
  );
  const linkableItemIds = useMemo(
    () => new Set(getVisibleDailyReviewLibraryItems(items).map((item) => item.id)),
    [items],
  );

  const candidates = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return allCandidates
      .filter((candidate) => !(candidate.kind === entityKind && candidate.id === entityId))
      .filter((candidate) => candidate.kind !== "item" || linkableItemIds.has(candidate.id))
      .filter((candidate) => !isAlreadyLinked(relatedLinks, entityKind, entityId, candidate.kind, candidate.id))
      .filter((candidate) => {
        if (!keyword) return true;
        return `${candidate.title} ${candidate.subtitle}`.toLowerCase().includes(keyword);
      })
      .slice(0, 30);
  }, [allCandidates, entityId, entityKind, linkableItemIds, query, relatedLinks]);

  const createLink = async (candidate: LinkCandidate) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setMessage("");
    try {
      await onCreateLink({
        sourceKind: entityKind,
        sourceId: entityId,
        targetKind: candidate.kind,
        targetId: candidate.id,
        relation: relation.trim() || "相关",
      });
      setOpen(false);
      setQuery("");
      setRelation("相关");
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "关联失败，请稍后再试。"));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const deleteLink = async (id: string) => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeletingId(id);
    setMessage("");
    try {
      await onDeleteLink(id);
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "删除关联失败，请稍后再试。"));
    } finally {
      deletingRef.current = false;
      setDeletingId("");
    }
  };

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Link2 size={16} />
          相关内容
        </div>
        <button
          className="soft-button action-compact"
          onClick={() => setOpen(true)}
        >
          <Plus size={14} />
          添加
        </button>
      </div>

      <ScrollableResultPanel
        title="已关联"
        count={`${relatedLinks.length} 条`}
        maxHeightClass="max-h-[260px]"
        bodyClassName="space-y-2"
        empty={relatedLinks.length === 0 ? <p className="px-1 py-2 text-sm leading-6 text-ink/42">还没有建立关联。</p> : undefined}
      >
        {relatedLinks.map((link) => {
            const linked = resolveLinkedEntity(link, entityKind, entityId, allCandidates);
            if (!linked) return null;
            const Icon = kindIcons[linked.kind];

            return (
              <ResultRow key={link.id} className="flex items-start gap-2">
                <button
                  className="ghost-action icon-action-micro mt-0.5 bg-surface"
                  onClick={() => onOpenEntity(linked.kind, linked.id)}
                  title="打开"
                  aria-label="打开关联内容"
                >
                  <Icon size={14} />
                </button>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => onOpenEntity(linked.kind, linked.id)}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="quiet-chip py-0.5 text-[11px] text-ink/42">
                      {kindLabels[linked.kind]}
                    </span>
                    <span className="max-w-full truncate rounded-full border border-lake/30 bg-lake/10 px-2 py-0.5 text-[11px] text-lake">
                      {link.relation}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-sm font-medium text-ink">{linked.title}</p>
                  <BoundedPreview maxLinesClass="line-clamp-1" className="mt-0.5 text-xs text-ink/45">
                    {linked.subtitle}
                  </BoundedPreview>
                </button>
                <button
                  className="danger-icon-action icon-action-micro"
                  disabled={deletingId === link.id}
                  onClick={() => setPendingDeleteId(link.id)}
                  title="删除关联"
                  aria-label="删除这条关联"
                >
                  <Trash2 size={13} />
                </button>
              </ResultRow>
            );
          })}
      </ScrollableResultPanel>
      {message && <p className="mt-2 text-xs leading-5 text-red-400">{message}</p>}

      <ConfirmDialog
        danger
        open={Boolean(pendingDeleteId)}
        title="删除这条关联？"
        message="只会删除这条关联关系，不会删除原始日志、资料、记忆或总结。"
        confirmLabel="删除关联"
        onCancel={() => setPendingDeleteId("")}
        onConfirm={async () => {
          const id = pendingDeleteId;
          if (!id) return;
          await deleteLink(id);
          setPendingDeleteId("");
        }}
      />

      {open && (
        <div className="modal-backdrop">
          <div aria-label="添加关联" aria-modal="true" className="modal-surface flex max-h-[92vh] w-full max-w-2xl flex-col" role="dialog">
            <div className="flex shrink-0 items-center justify-between border-b border-line bg-panel/70 px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-ink">添加关联</h3>
                <p className="mt-0.5 text-xs text-ink/45">只记录关系，不移动或读取真实文件。</p>
              </div>
              <button
                className="ghost-action icon-action-compact"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                title="关闭"
              >
                <X size={16} />
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
              {message && <div className="rounded-[8px] border border-line bg-panel px-3 py-2 text-sm text-red-400">{message}</div>}
              <div className="grid gap-2 md:grid-cols-[160px_minmax(0,1fr)]">
                <input
                  value={relation}
                  onChange={(event) => setRelation(event.target.value)}
                  placeholder="关系，例如：相关、提炼自"
                  className="field-control field-prominent"
                />
                <div className="field-control field-prominent flex items-center gap-2">
                  <Search size={16} className="ui-text-meta" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索日志、资料、记忆或总结"
                    className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink/35"
                  />
                </div>
              </div>

              <ScrollableResultPanel
                title="可关联内容"
                count={`${candidates.length} 条`}
                maxHeightClass="max-h-[420px]"
                bodyClassName="space-y-1"
                empty={
                  candidates.length === 0 ? (
                    <div className="flex min-h-[160px] items-center justify-center text-sm text-ink/42">
                      没有可关联的内容。
                    </div>
                  ) : undefined
                }
              >
                    {candidates.map((candidate) => {
                      const Icon = kindIcons[candidate.kind];
                      return (
                        <ResultRow
                          key={`${candidate.kind}-${candidate.id}`}
                          className="flex items-start gap-3 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={saving}
                          onClick={() => createLink(candidate)}
                        >
                          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-panel text-ink/50">
                            <Icon size={15} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="text-xs text-ink/42">{kindLabels[candidate.kind]}</span>
                            <span className="mt-0.5 block truncate text-sm font-medium text-ink">
                              {candidate.title}
                            </span>
                            <BoundedPreview maxLinesClass="line-clamp-2" className="mt-1 text-xs leading-5 text-ink/48">
                              {candidate.subtitle}
                            </BoundedPreview>
                          </span>
                        </ResultRow>
                      );
                    })}
              </ScrollableResultPanel>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function buildCandidates(
  items: Item[],
  journalEntries: JournalEntry[],
  memories: MemoryCard[],
  reports: SummaryReport[],
): LinkCandidate[] {
  return [
    ...journalEntries.map((entry) => ({
      kind: "journal" as const,
      id: entry.id,
      title: `日志 · ${entry.entryDate}`,
      subtitle: entry.content || entry.tags.join("，") || "无正文",
    })),
    ...items.map((item) => ({
      kind: "item" as const,
      id: item.id,
      title: item.title,
      subtitle: item.content || item.aiSummary || item.tags.join("，") || "无正文",
    })),
    ...memories.map((memory) => ({
      kind: "memory" as const,
      id: memory.id,
      title: memory.title,
      subtitle: `${memory.category} · ${memory.content}`,
    })),
    ...reports.map((report) => ({
      kind: "summary" as const,
      id: report.id,
      title: report.title,
      subtitle: `${report.periodStart} 至 ${report.periodEnd} · ${report.content}`,
    })),
  ];
}

function isAlreadyLinked(
  links: KnowledgeLink[],
  entityKind: EntityKind,
  entityId: string,
  targetKind: EntityKind,
  targetId: string,
) {
  return links.some(
    (link) =>
      (link.sourceKind === entityKind &&
        link.sourceId === entityId &&
        link.targetKind === targetKind &&
        link.targetId === targetId) ||
      (link.targetKind === entityKind &&
        link.targetId === entityId &&
        link.sourceKind === targetKind &&
        link.sourceId === targetId),
  );
}

function resolveLinkedEntity(
  link: KnowledgeLink,
  entityKind: EntityKind,
  entityId: string,
  candidates: LinkCandidate[],
) {
  const target =
    link.sourceKind === entityKind && link.sourceId === entityId
      ? { kind: link.targetKind, id: link.targetId }
      : { kind: link.sourceKind, id: link.sourceId };

  return candidates.find((candidate) => candidate.kind === target.kind && candidate.id === target.id);
}
