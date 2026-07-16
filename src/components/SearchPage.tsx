import { Brain, FileText, History, Library, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchKnowledge } from "../data/itemStore";
import { PageWorkspace } from "./PageWorkspace";
import { BoundedPreview, ResultRow, ScrollableResultPanel } from "./ResultPanels";
import type { EntityKind, SearchResult } from "../types";

type SearchGroups = Record<EntityKind, SearchResult[]>;

type SearchPageProps = {
  onOpenResult: (result: SearchResult) => void;
  refreshKey?: number;
};

const emptyResults: SearchGroups = {
  journal: [],
  item: [],
  memory: [],
  summary: [],
};

const initialLimits: Record<EntityKind, number> = {
  journal: 20,
  item: 20,
  memory: 20,
  summary: 20,
};

const groups: Array<{ kind: EntityKind; label: string; icon: typeof Search }> = [
  { kind: "journal", label: "日志", icon: FileText },
  { kind: "item", label: "资料", icon: Library },
  { kind: "memory", label: "记忆", icon: Brain },
  { kind: "summary", label: "总结", icon: History },
];

export function SearchPage({ onOpenResult, refreshKey = 0 }: SearchPageProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchGroups>(emptyResults);
  const [limits, setLimits] = useState<Record<EntityKind, number>>(initialLimits);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [shouldAutoFocus, setShouldAutoFocus] = useState(false);
  const lastKeywordRef = useRef("");
  const requestSeqRef = useRef(0);
  const maxLimit = useMemo(() => Math.max(...Object.values(limits)), [limits]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    const wideEnough = window.matchMedia("(min-width: 768px)").matches;
    setShouldAutoFocus(!coarsePointer || wideEnough);
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    const keywordChanged = lastKeywordRef.current !== keyword;
    const limitPerKind = keywordChanged ? 20 : maxLimit;
    lastKeywordRef.current = keyword;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;

    if (keywordChanged) {
      setLimits(initialLimits);
      setResults(emptyResults);
      setError("");
    }

    if (!keyword) {
      setResults(emptyResults);
      setError("");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const nextResults = await searchKnowledge(keyword, { limitPerKind: limitPerKind + 1 });
        if (!cancelled && requestSeqRef.current === requestSeq) {
          setResults(nextResults);
          setError("");
        }
      } catch (searchError) {
        if (!cancelled && requestSeqRef.current === requestSeq) {
          setResults(emptyResults);
          setError(searchError instanceof Error ? searchError.message : "搜索失败，请稍后再试。");
        }
      } finally {
        if (!cancelled && requestSeqRef.current === requestSeq) setLoading(false);
      }
    }, 220);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [maxLimit, query, refreshKey]);

  const visibleResults = useMemo(
    () =>
      groups.reduce((acc, group) => {
        acc[group.kind] = results[group.kind].slice(0, limits[group.kind]);
        return acc;
      }, { ...emptyResults } as SearchGroups),
    [limits, results],
  );

  const totalCount = useMemo(
    () => Object.values(visibleResults).reduce((count, groupResults) => count + groupResults.length, 0),
    [visibleResults],
  );
  const hasKeyword = Boolean(query.trim());

  return (
    <PageWorkspace
      eyebrow="Search"
      title="搜寻"
      description="从日志、资料、记忆和回顾里找回旧线索。"
      meta={query.trim() ? `${totalCount} 条结果` : "等一个关键词"}
    >
      <div className="flex h-full min-h-0 flex-col px-4 pb-20 pt-4 sm:pb-4">
        <div className="field-control field-prominent flex shrink-0 items-center gap-3">
          <Search size={19} className="ui-text-meta" />
          <input
            autoFocus={shouldAutoFocus}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                setQuery("");
              }
            }}
            placeholder="搜索标题、正文、标签、摘要或待办"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink/35"
          />
          {query && (
            <button className="ghost-action icon-action-compact" onClick={() => setQuery("")} title="清空搜索" aria-label="清空搜索">
              <X size={15} />
            </button>
          )}
        </div>
        <div className="mt-4 min-h-0 flex-1">
          <ScrollableResultPanel
            fill
            title="搜索结果"
            count={error ? "出错" : query.trim() ? `${totalCount} 条` : "等待关键词"}
            status={error || (loading ? "正在搜索" : query.trim() ? "按内容类型显示" : "")}
            bodyClassName="space-y-4 p-3"
            empty={
              error ? (
                <EmptySearch text={error} />
              ) : !hasKeyword ? (
                <EmptySearch text="写下一个关键词，就能从旧处找回它。" />
              ) : loading && totalCount === 0 ? (
                <EmptySearch text="正在寻找。" />
              ) : totalCount === 0 ? (
                <EmptySearch text="没有找到相符的内容。" />
              ) : undefined
            }
          >
            {groups.map((group) => (
              <SearchGroup
                key={group.kind}
                label={group.label}
                icon={group.icon}
                results={visibleResults[group.kind]}
                canLoadMore={results[group.kind].length > visibleResults[group.kind].length}
                onLoadMore={() => setLimits((current) => ({ ...current, [group.kind]: current[group.kind] + 20 }))}
                onOpenResult={onOpenResult}
              />
            ))}
          </ScrollableResultPanel>
        </div>
      </div>
    </PageWorkspace>
  );
}

function SearchGroup({
  label,
  icon: Icon,
  results,
  canLoadMore,
  onLoadMore,
  onOpenResult,
}: {
  label: string;
  icon: typeof Search;
  results: SearchResult[];
  canLoadMore: boolean;
  onLoadMore: () => void;
  onOpenResult: (result: SearchResult) => void;
}) {
  if (results.length === 0) return null;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Icon size={16} />
          {label}
        </div>
        <span className="quiet-chip text-ink/45">{results.length}</span>
      </div>

      <div className="divide-y divide-line/70">
        {results.map((result) => (
          <ResultRow
            key={`${result.kind}-${result.id}`}
            onClick={() => onOpenResult(result)}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="min-w-0 flex-1 truncate text-anywhere text-sm font-semibold text-ink">{result.title}</h3>
              <span className="text-xs text-ink/38">{result.updatedAt}</span>
            </div>
            <BoundedPreview maxLinesClass="line-clamp-2" className="mt-1 text-sm leading-6 text-ink/58">
              {result.snippet}
            </BoundedPreview>
          </ResultRow>
        ))}
      </div>

      {canLoadMore && (
        <button
          className="soft-button action-standard mt-3"
          onClick={onLoadMore}
        >
          加载更多结果
        </button>
      )}
    </section>
  );
}

function EmptySearch({ text }: { text: string }) {
  return (
    <div className="flex min-h-[140px] items-center justify-center bg-transparent p-6 text-center text-anywhere text-sm leading-6 text-ink/42 sm:min-h-[200px]">
      {text}
    </div>
  );
}
