import { Clock3, RotateCcw, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { getSafeErrorMessage } from "../lib/redaction";
import {
  compareDailyReviewLibraryVersions,
  getDailyReviewLibraryRevision,
  getDailyReviewLibraryRevisionKind,
  type DailyReviewLibraryRevisionKind,
} from "../lib/reviewLibraryPublication";
import type { Item } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

type ReviewLibraryHistoryDialogProps = {
  open: boolean;
  displayedItemId: string;
  currentItem: Item | null;
  versions: Item[];
  onClose: () => void;
  onOpenItem: (itemId: string) => Promise<void> | void;
  onRestore: (version: Item, expectedCurrentItem: Item) => Promise<void> | void;
};

export function ReviewLibraryHistoryDialog({
  open,
  displayedItemId,
  currentItem,
  versions,
  onClose,
  onOpenItem,
  onRestore,
}: ReviewLibraryHistoryDialogProps) {
  const [pendingRestore, setPendingRestore] = useState<Item | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [openingItemId, setOpeningItemId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const sortedVersions = useMemo(() => [...versions].sort(compareDailyReviewLibraryVersions), [versions]);
  const busy = restoring || openingItemId !== null;
  const openingVersion = openingItemId
    ? sortedVersions.find((version) => version.id === openingItemId)
    : null;

  useEffect(() => {
    if (!open) {
      setPendingRestore(null);
      setRestoring(false);
      setOpeningItemId(null);
      setMessage("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      const previous = previouslyFocusedRef.current;
      previouslyFocusedRef.current = null;
      if (previous?.isConnected) window.setTimeout(() => previous.focus(), 0);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (pendingRestore) return;
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [busy, onClose, open, pendingRestore]);

  if (!open) return null;

  const openItem = async (itemId: string) => {
    if (busy) return;
    setOpeningItemId(itemId);
    setMessage("");
    try {
      await onOpenItem(itemId);
      onClose();
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "打开资料版本失败，请稍后重试。"));
    } finally {
      setOpeningItemId(null);
    }
  };

  const restore = async () => {
    if (!pendingRestore || !currentItem || restoring) return;
    setRestoring(true);
    setMessage("");
    try {
      await onRestore(pendingRestore, currentItem);
      setPendingRestore(null);
      onClose();
    } catch (error) {
      setMessage(getSafeErrorMessage(error, "恢复资料版本失败，请重新打开版本历史后再试。"));
      setPendingRestore(null);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section
        aria-busy={busy}
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-surface flex max-h-[88vh] w-full max-w-3xl flex-col"
        ref={dialogRef}
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-panel/70 px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-copper">
              <Clock3 size={14} />
              Review History
            </div>
            <h2 className="mt-1 text-lg font-semibold text-ink" id={titleId}>资料版本历史</h2>
            <p className="mt-1 text-sm leading-6 text-ink/52" id={descriptionId}>
              共 {sortedVersions.length} 个版本。恢复不会覆盖旧版本，而会创建一个新的当前版本。
            </p>
          </div>
          <button className="soft-button icon-action-standard" disabled={busy} onClick={onClose} ref={closeButtonRef} aria-label="关闭版本历史" title="关闭">
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
          {message && (
            <p className="mb-3 rounded-[8px] border border-line bg-panel px-3 py-2 text-anywhere text-sm leading-6 text-red-400" role="alert">
              {message}
            </p>
          )}
          {openingVersion && (
            <p className="mb-3 rounded-[8px] border border-line bg-panel px-3 py-2 text-sm leading-6 text-ink/58" aria-live="polite" role="status">
              正在打开版本 {getDailyReviewLibraryRevision(openingVersion)}，请稍候。
            </p>
          )}
          {sortedVersions.length === 0 ? (
            <p className="rounded-[8px] border border-dashed border-line bg-panel/55 p-5 text-center text-sm leading-6 text-ink/45">
              暂时没有可查看的资料版本。
            </p>
          ) : (
            <div className="space-y-2">
              {sortedVersions.map((version) => {
                const revision = getDailyReviewLibraryRevision(version);
                const isCurrent = version.id === currentItem?.id;
                const isDisplayed = version.id === displayedItemId;
                return (
                  <article key={version.id} className={`rounded-[8px] border p-3 ${isCurrent ? "border-copper/30 bg-copper/5" : "border-line bg-panel/65"}`}>
                    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-ink">版本 {revision}</span>
                          <span className="quiet-chip py-0.5 text-[11px]">{revisionKindLabel(getDailyReviewLibraryRevisionKind(version))}</span>
                          {isCurrent && <span className="rounded-full border border-copper/30 bg-copper/10 px-2 py-0.5 text-[11px] font-medium text-copper">当前</span>}
                          {isDisplayed && !isCurrent && <span className="quiet-chip py-0.5 text-[11px]">正在查看</span>}
                        </div>
                        <h3 className="mt-1.5 line-clamp-2 text-anywhere text-sm font-medium leading-6 text-ink/72">{version.title}</h3>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs leading-5 text-ink/42">
                          <span>创建：{version.createdAt}</span>
                          {version.updatedAt !== version.createdAt && <span>编辑：{version.updatedAt}</span>}
                          {version.origin?.derivedFromRevision && <span>源自版本 {version.origin.derivedFromRevision}</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {!isDisplayed && (
                          <button className="secondary-action action-compact" disabled={busy} onClick={() => void openItem(version.id)}>
                            {openingItemId === version.id ? "正在打开" : "打开"}
                          </button>
                        )}
                        {!isCurrent && (
                          <button className="soft-button action-compact" disabled={busy || !currentItem} onClick={() => setPendingRestore(version)}>
                            <RotateCcw size={14} />
                            恢复为新版本
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={Boolean(pendingRestore)}
        title={`恢复版本 ${pendingRestore ? getDailyReviewLibraryRevision(pendingRestore) : ""}？`}
        message="将以该历史版本当前的标题和正文创建新版本；正式回顾和已有资料版本都不会被修改。"
        confirmLabel="恢复为新版本"
        onCancel={() => setPendingRestore(null)}
        onConfirm={restore}
      />
    </div>
  );
}

function revisionKindLabel(kind: DailyReviewLibraryRevisionKind) {
  if (kind === "restore") return "恢复版本";
  if (kind === "reactivation") return "重新启用";
  return "来源版本";
}
