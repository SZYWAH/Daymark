import { BookOpen, Clock3, Heart, Inbox, ListChecks, Tag, type LucideIcon } from "lucide-react";
import { getLibraryStats } from "../lib/libraryViews";
import type { ActiveView, Item, SmartView } from "../types";

const smartViews: Array<{ id: SmartView; label: string; icon: LucideIcon }> = [
  { id: "attention", label: "待处理", icon: ListChecks },
  { id: "inbox", label: "收件箱", icon: Inbox },
  { id: "unfiled", label: "未归档", icon: Tag },
  { id: "recent", label: "最近打开", icon: Clock3 },
  { id: "favorite", label: "收藏", icon: Heart },
  { id: "reading", label: "待读", icon: BookOpen },
];

export function LibrarySmartToolbar({
  items,
  activeView,
  onSelectView,
}: {
  items: Item[];
  activeView: ActiveView;
  onSelectView: (view: SmartView) => void;
}) {
  const libraryStats = getLibraryStats(items);
  const counts: Record<SmartView, number> = {
    attention: libraryStats.attention,
    inbox: libraryStats.inbox,
    unfiled: libraryStats.unfiled,
    recent: items.filter((item) => item.lastOpenedAt).length || items.length,
    favorite: items.filter((item) => item.favorite).length,
    reading: libraryStats.reading,
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 overflow-x-auto scrollbar-thin">
      {smartViews.map((view) => {
        const Icon = view.icon;
        const active = activeView.kind === "smart" && activeView.id === view.id;

        return (
          <button
            key={view.id}
            className={`flex h-7 shrink-0 items-center gap-1.5 border-b text-xs transition ${
              active
                ? "border-accent text-ink"
                : "border-transparent text-ink/58 hover:border-line hover:text-ink"
            }`}
            onClick={() => onSelectView(view.id)}
          >
            <Icon size={15} />
            <span>{view.label}</span>
            <span className={`text-[11px] ${active ? "text-ink/45" : "hidden text-ink/32 xl:inline"}`}>
              {counts[view.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
