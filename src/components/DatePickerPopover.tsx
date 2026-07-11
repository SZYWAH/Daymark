import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toDateKey } from "../lib/date";

const POPOVER_WIDTH = 260;
const POPOVER_ESTIMATED_HEIGHT = 354;
const POPOVER_GAP = 8;
const VIEWPORT_MARGIN = 8;

type DatePickerPopoverProps = {
  value: string;
  onChange: (date: string) => void;
  onClear: () => void;
  placeholder: string;
  buttonLabel: string;
};

export function DatePickerPopover({
  value,
  onChange,
  onClear,
  placeholder,
  buttonLabel,
}: DatePickerPopoverProps) {
  const today = toDateKey(new Date());
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value || today).slice(0, 7));
  const [popoverPosition, setPopoverPosition] = useState<{ left: number; top: number } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLElement | null>(null);
  const days = useMemo(() => getCalendarDays(month), [month]);

  useEffect(() => {
    if (open) setMonth((value || today).slice(0, 7));
  }, [open, today, value]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) {
      setPopoverPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = rootRef.current;
      if (!trigger) return;

      const triggerRect = trigger.getBoundingClientRect();
      const popoverHeight = popoverRef.current?.offsetHeight || POPOVER_ESTIMATED_HEIGHT;
      const left = Math.min(
        Math.max(VIEWPORT_MARGIN, triggerRect.left),
        Math.max(VIEWPORT_MARGIN, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN),
      );
      const belowTop = triggerRect.bottom + POPOVER_GAP;
      const top = belowTop + popoverHeight <= window.innerHeight - VIEWPORT_MARGIN
        ? belowTop
        : Math.max(VIEWPORT_MARGIN, triggerRect.top - POPOVER_GAP - popoverHeight);

      setPopoverPosition((current) => (
        current?.left === left && current.top === top ? current : { left, top }
      ));
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`field-control field-standard flex w-full items-center justify-between gap-2 px-2 text-left text-xs ${
          value ? "font-mono text-ink" : "text-ink/35"
        }`}
        onClick={() => setOpen((current) => !current)}
        aria-label={buttonLabel}
        aria-expanded={open}
      >
        <span className="truncate">{value || placeholder}</span>
        <CalendarDays size={14} className="shrink-0 text-ink/50" />
      </button>

      {open && popoverPosition && createPortal(
        <section
          ref={popoverRef}
          className="fixed z-[100] w-[260px] rounded-[8px] border border-line bg-surface p-3 shadow-panel"
          style={popoverPosition}
          role="dialog"
          aria-label={buttonLabel}
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="soft-button icon-action-compact"
              onClick={() => setMonth(shiftMonth(month, -1))}
              title="上个月"
              aria-label="上个月"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="text-sm font-semibold text-ink">{formatMonthLabel(month)}</div>
            <button
              type="button"
              className="soft-button icon-action-compact"
              onClick={() => setMonth(shiftMonth(month, 1))}
              title="下个月"
              aria-label="下个月"
            >
              <ChevronRight size={15} />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-ink/35">
            {["一", "二", "三", "四", "五", "六", "日"].map((day) => (
              <span key={day} className="py-1">
                {day}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((dateKey) => {
              const isCurrentMonth = dateKey.slice(0, 7) === month;
              const isSelected = value === dateKey;
              const isToday = dateKey === today;
              return (
                <button
                  key={dateKey}
                  type="button"
                  className={`relative flex h-8 items-center justify-center rounded-[8px] text-xs transition ${
                    isSelected
                      ? "bg-accent/20 font-semibold text-accent ring-1 ring-accent/25"
                      : isToday
                        ? "bg-lake/10 font-semibold text-lake"
                        : isCurrentMonth
                          ? "text-ink/70 hover:bg-panel hover:text-ink"
                          : "text-ink/24 hover:bg-panel"
                  }`}
                  onClick={() => {
                    if (!isCurrentMonth) setMonth(dateKey.slice(0, 7));
                    onChange(dateKey);
                    setOpen(false);
                  }}
                  aria-current={isToday ? "date" : undefined}
                  aria-pressed={isSelected}
                >
                  {Number(dateKey.slice(8, 10))}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <button
              type="button"
              className="soft-button action-compact"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              清空
            </button>
            <button
              type="button"
              className="soft-button action-compact"
              onClick={() => {
                onChange(today);
                setOpen(false);
              }}
            >
              今天
            </button>
          </div>
        </section>,
        document.body,
      )}
    </div>
  );
}

function getCalendarDays(month: string) {
  const [year, monthValue] = month.split("-").map(Number);
  const startOffset = 1 - getMondayFirstDayOfWeek(year, monthValue, 1);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(year, monthValue - 1, 1 + startOffset + index, 12);
    return toDateKey(date);
  });
}

function getMondayFirstDayOfWeek(year: number, month: number, day: number) {
  const nativeDay = new Date(year, month - 1, day, 12).getDay();
  return nativeDay === 0 ? 7 : nativeDay;
}

function shiftMonth(month: string, offset: number) {
  const [year, monthValue] = month.split("-").map(Number);
  const date = new Date(year, monthValue - 1 + offset, 1);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}`;
}

function formatMonthLabel(month: string) {
  const [year, monthValue] = month.split("-");
  return `${year} 年 ${Number(monthValue)} 月`;
}
